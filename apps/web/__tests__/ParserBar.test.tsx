import '@testing-library/jest-dom';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ParserBar from '../src/components/ParserBar.js';

// Mock stores
const mockUpdateParserInput = jest.fn();
const mockSubmitParsedEntry = jest.fn();
const mockClearParserState = jest.fn();
const mockGetEntriesForLedger = jest.fn(() => []);

const mockEntryStoreState = {
  parserPreview: null as object | null,
  parserInput: '',
  updateParserInput: mockUpdateParserInput,
  submitParsedEntry: mockSubmitParsedEntry,
  clearParserState: mockClearParserState,
  getEntriesForLedger: mockGetEntriesForLedger,
};

const mockLedgerStoreState = {
  ledgers: [
    {
      ledger_id: 'l1',
      book_id: 'book-1',
      ledger_name: 'Groceries',
      icon: '🛒',
      ledger_color: null,
      alias: 'groc',
      balance: 100,
      status: 1,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: null,
    },
  ],
};

const mockSettingsStoreState = {
  settings: {
    app_settings_id: 's1',
    dark_mode: 0,
    week_start_day: 1,
    weekend_start_day: 6,
    cat_default_entry_direction: 'sub',
    status: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: null,
  },
};

jest.mock('@ledger/stores', () => ({
  useEntryStore: () => mockEntryStoreState,
  useLedgerStore: () => mockLedgerStoreState,
  useSettingsStore: () => mockSettingsStoreState,
}));

function renderParserBar(onClose = jest.fn()) {
  return render(<ParserBar bookId="book-1" onClose={onClose} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEntryStoreState.parserInput = '';
  mockEntryStoreState.parserPreview = null;
  mockUpdateParserInput.mockImplementation(() => {});
  mockSubmitParsedEntry.mockResolvedValue({ success: true });
});

describe('ParserBar', () => {
  it('renders text input', () => {
    renderParserBar();
    expect(screen.getByPlaceholderText('today 50 #groceries coffee')).toBeInTheDocument();
  });

  it('renders Cancel and Add buttons', () => {
    renderParserBar();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Add ✓')).toBeInTheDocument();
  });

  it('calls updateParserInput on each keystroke', async () => {
    const user = userEvent.setup();
    renderParserBar();
    const input = screen.getByPlaceholderText('today 50 #groceries coffee');
    await user.type(input, 'hello');
    expect(mockUpdateParserInput).toHaveBeenCalled();
  });

  it('submit button is disabled when input is empty', () => {
    mockEntryStoreState.parserInput = '';
    renderParserBar();
    expect(screen.getByText('Add ✓')).toBeDisabled();
  });

  it('submit button is disabled when parserPreview has errors', () => {
    mockEntryStoreState.parserInput = 'some input';
    mockEntryStoreState.parserPreview = {
      raw: 'some input',
      parsed_date: '2024-01-25',
      parsed_ledger: null,
      parsed_amount: 50,
      parsed_direction: 'sub',
      parsed_detail: null,
      is_transfer: false,
      resolved_transfer_target: null,
      errors: ['Transfer requires a source ledger'],
      warnings: [],
    };
    renderParserBar();
    expect(screen.getByText('Add ✓')).toBeDisabled();
  });

  it('submit button is disabled when no amount in preview', () => {
    mockEntryStoreState.parserInput = 'today #groc coffee';
    mockEntryStoreState.parserPreview = {
      raw: 'today #groc coffee',
      parsed_date: '2024-01-25',
      parsed_ledger: { ledger_id: 'l1', book_id: 'book-1', ledger_name: 'Groceries', icon: '🛒', ledger_color: null, alias: 'groc', balance: 100, status: 1, created_at: '2024-01-01T00:00:00Z', updated_at: null },
      parsed_amount: null,
      parsed_direction: 'sub',
      parsed_detail: 'coffee',
      is_transfer: false,
      resolved_transfer_target: null,
      errors: [],
      warnings: ['No amount detected'],
    };
    renderParserBar();
    expect(screen.getByText('Add ✓')).toBeDisabled();
  });

  it('calls clearParserState and onClose when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    renderParserBar(onClose);
    await user.click(screen.getByText('Cancel'));
    expect(mockClearParserState).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls submitParsedEntry and onClose on successful submit', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    const preview = {
      raw: 'today 50 #groc coffee',
      parsed_date: '2024-01-25',
      parsed_ledger: { ledger_id: 'l1', book_id: 'book-1', ledger_name: 'Groceries', icon: '🛒', ledger_color: null, alias: 'groc', balance: 100, status: 1, created_at: '2024-01-01T00:00:00Z', updated_at: null },
      parsed_amount: 50,
      parsed_direction: 'sub',
      parsed_detail: 'coffee',
      is_transfer: false,
      resolved_transfer_target: null,
      errors: [],
      warnings: [],
    };
    mockEntryStoreState.parserInput = 'today 50 #groc coffee';
    mockEntryStoreState.parserPreview = preview;
    mockSubmitParsedEntry.mockResolvedValue({ success: true });

    renderParserBar(onClose);

    await act(async () => {
      await user.click(screen.getByText('Add ✓'));
    });

    expect(mockSubmitParsedEntry).toHaveBeenCalledWith(
      expect.objectContaining({ book_id: 'book-1', preview }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows error message when submit fails', async () => {
    const user = userEvent.setup();
    const preview = {
      raw: 'today 50 #groc',
      parsed_date: '2024-01-25',
      parsed_ledger: { ledger_id: 'l1', book_id: 'book-1', ledger_name: 'Groceries', icon: '🛒', ledger_color: null, alias: 'groc', balance: 100, status: 1, created_at: '2024-01-01T00:00:00Z', updated_at: null },
      parsed_amount: 50,
      parsed_direction: 'sub',
      parsed_detail: null,
      is_transfer: false,
      resolved_transfer_target: null,
      errors: [],
      warnings: [],
    };
    mockEntryStoreState.parserInput = 'today 50 #groc';
    mockEntryStoreState.parserPreview = preview;
    mockSubmitParsedEntry.mockResolvedValue({ success: false, error: 'DB error' });

    renderParserBar();

    await act(async () => {
      await user.click(screen.getByText('Add ✓'));
    });

    expect(screen.getByText('✗ DB error')).toBeInTheDocument();
  });

  it('renders warning messages from parserPreview', () => {
    mockEntryStoreState.parserInput = 'today #groc';
    mockEntryStoreState.parserPreview = {
      raw: 'today #groc',
      parsed_date: '2024-01-25',
      parsed_ledger: { ledger_id: 'l1', book_id: 'book-1', ledger_name: 'Groceries', icon: '🛒', ledger_color: null, alias: 'groc', balance: 100, status: 1, created_at: '2024-01-01T00:00:00Z', updated_at: null },
      parsed_amount: null,
      parsed_direction: 'sub',
      parsed_detail: null,
      is_transfer: false,
      resolved_transfer_target: null,
      errors: [],
      warnings: ['No amount detected'],
    };
    renderParserBar();
    expect(screen.getByText('⚠ No amount detected')).toBeInTheDocument();
  });

  it('override fields render date input', () => {
    renderParserBar();
    const dateInput = screen.getByLabelText('Date');
    expect(dateInput).toBeInTheDocument();
    expect(dateInput).toHaveAttribute('type', 'date');
  });

  describe('ledger suggestion dropdown', () => {
    // An unresolved '#' token at the end of the input is what opens the list.
    function showSuggestions() {
      mockEntryStoreState.parserInput = 'today 50 #gro';
      mockEntryStoreState.parserPreview = {
        raw: 'today 50 #gro',
        parsed_date: '2024-01-25',
        parsed_ledger: null,
        parsed_amount: 50,
        parsed_direction: 'sub',
        parsed_detail: null,
        is_transfer: false,
        resolved_transfer_target: null,
        errors: [],
        warnings: [],
      };
      return renderParserBar();
    }

    it('keeps focus on the input when a suggestion is tapped', async () => {
      const user = userEvent.setup();
      showSuggestions();
      const input = screen.getByPlaceholderText('today 50 #groceries coffee');
      const suggestion = screen.getByText('Groceries');

      act(() => input.focus());
      expect(input).toHaveFocus();

      await act(async () => {
        await user.click(suggestion);
      });

      // On Android, losing focus here dismisses the soft keyboard mid-entry.
      expect(input).toHaveFocus();
      expect(mockUpdateParserInput).toHaveBeenCalled();
    });

    it('cancels mousedown on suggestions so focus is never moved', () => {
      showSuggestions();
      const suggestion = screen.getByText('Groceries').closest('button')!;

      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      suggestion.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it('keeps suggestions out of the tab order', () => {
      showSuggestions();
      expect(screen.getByText('Groceries').closest('button')).toHaveAttribute('tabindex', '-1');
    });
  });
});
