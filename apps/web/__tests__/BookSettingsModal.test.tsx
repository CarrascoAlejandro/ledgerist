import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BookSettingsModal from '../src/components/BookSettingsModal.js';
import type { Book, Ledger } from '@ledger/shared';
import { todayISO } from '@ledger/shared';

const mockRenameBook = jest.fn();
const mockCloseBook = jest.fn();
const mockReopenBook = jest.fn();
const mockAddEntry = jest.fn();
const mockGetLedgersForBook = jest.fn();

const mockBookStoreState = {
  renameBook: mockRenameBook,
  closeBook: mockCloseBook,
  reopenBook: mockReopenBook,
};

const mockLedgerStoreState = {
  getLedgersForBook: mockGetLedgersForBook,
};

const mockEntryStoreState = {
  addEntry: mockAddEntry,
};

jest.mock('@ledger/stores', () => ({
  useBookStore: () => mockBookStoreState,
  useLedgerStore: () => mockLedgerStoreState,
  useEntryStore: () => mockEntryStoreState,
}));

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    book_id: 'book-1',
    name: 'Test Book',
    is_closed: 0,
    is_balanced: 0,
    is_auto_open: 0,
    status: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: null,
    ...overrides,
  };
}

function makeLedger(overrides: Partial<Ledger> = {}): Ledger {
  return {
    ledger_id: 'ledger-1',
    book_id: 'book-1',
    ledger_name: 'Groceries',
    icon: '🛒',
    ledger_color: null,
    alias: null,
    balance: 0,
    status: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRenameBook.mockResolvedValue({ success: true });
  mockCloseBook.mockResolvedValue({ success: true });
  mockReopenBook.mockResolvedValue({ success: true });
  mockAddEntry.mockResolvedValue({ success: true });
});

describe('BookSettingsModal', () => {
  it('closes balanced books without confirmation', async () => {
    mockGetLedgersForBook.mockReturnValue([makeLedger({ balance: 0 })]);
    const onClose = jest.fn();
    const user = userEvent.setup();

    render(<BookSettingsModal book={makeBook()} onClose={onClose} />);

    await user.click(screen.getByText('Close Book'));

    await waitFor(() => expect(mockCloseBook).toHaveBeenCalledWith('book-1'));
    expect(mockAddEntry).not.toHaveBeenCalled();
    expect(screen.queryByText('Force Close')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it('creates adjustment entries before closing unbalanced books', async () => {
    mockGetLedgersForBook.mockReturnValue([
      makeLedger({ ledger_id: 'ledger-1', balance: 20 }),
      makeLedger({ ledger_id: 'ledger-2', ledger_name: 'Travel', balance: -15 }),
    ]);
    const onClose = jest.fn();
    const user = userEvent.setup();
    const today = todayISO();

    render(<BookSettingsModal book={makeBook()} onClose={onClose} />);

    await user.click(screen.getByText('Close Book'));

    expect(screen.getByText('Force Close')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Force Close' }));

    await waitFor(() => expect(mockAddEntry).toHaveBeenCalledTimes(2));
    expect(mockAddEntry).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        book_id: 'book-1',
        ledger_id: 'ledger-1',
        entry_date: today,
        detail: 'Balance adjustment',
        amount: 20,
        cat_direction: 'sub',
      }),
    );
    expect(mockAddEntry).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        book_id: 'book-1',
        ledger_id: 'ledger-2',
        entry_date: today,
        detail: 'Balance adjustment',
        amount: 15,
        cat_direction: 'add',
      }),
    );
    await waitFor(() => expect(mockCloseBook).toHaveBeenCalledWith('book-1'));
    expect(onClose).toHaveBeenCalled();
  });
});
