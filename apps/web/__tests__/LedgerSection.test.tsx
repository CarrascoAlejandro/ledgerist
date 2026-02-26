import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LedgerSection from '../src/components/LedgerSection.js';
import type { Ledger, Entry } from '@ledger/shared';

function makeLedger(overrides: Partial<Ledger> = {}): Ledger {
  return {
    ledger_id: 'ledger-1',
    book_id: 'book-1',
    ledger_name: 'Groceries',
    icon: '🛒',
    ledger_color: null,
    alias: 'groc',
    balance: 150,
    status: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: null,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    entry_id: 'entry-1',
    ledger_id: 'ledger-1',
    book_id: 'book-1',
    entry_date: '2024-01-25',
    detail: 'Coffee at shop',
    amount: 4.5,
    cat_direction: 'sub',
    transfer_group_id: null,
    status: 1,
    created_at: '2024-01-25T00:00:00Z',
    updated_at: null,
    ...overrides,
  };
}

describe('LedgerSection', () => {
  it('renders ledger name and icon', () => {
    render(
      <LedgerSection
        ledger={makeLedger()}
        entries={[]}
        isCollapsed={false}
        onToggleCollapse={() => {}}
      />,
    );
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('🛒')).toBeInTheDocument();
  });

  it('renders balance in header', () => {
    render(
      <LedgerSection
        ledger={makeLedger({ balance: 150 })}
        entries={[]}
        isCollapsed={false}
        onToggleCollapse={() => {}}
      />,
    );
    expect(screen.getByText('+150.00')).toBeInTheDocument();
  });

  it('calls onToggleCollapse when header is clicked', async () => {
    const user = userEvent.setup();
    const handleToggle = jest.fn();
    render(
      <LedgerSection
        ledger={makeLedger()}
        entries={[]}
        isCollapsed={false}
        onToggleCollapse={handleToggle}
      />,
    );
    await user.click(screen.getByRole('button'));
    expect(handleToggle).toHaveBeenCalledTimes(1);
  });

  it('shows collapse chevron ▾ when expanded', () => {
    render(
      <LedgerSection
        ledger={makeLedger()}
        entries={[]}
        isCollapsed={false}
        onToggleCollapse={() => {}}
      />,
    );
    expect(screen.getByText('▾')).toBeInTheDocument();
  });

  it('shows collapse chevron › when collapsed', () => {
    render(
      <LedgerSection
        ledger={makeLedger()}
        entries={[]}
        isCollapsed={true}
        onToggleCollapse={() => {}}
      />,
    );
    expect(screen.getByText('›')).toBeInTheDocument();
  });

  it('shows empty state when no entries and expanded', () => {
    render(
      <LedgerSection
        ledger={makeLedger()}
        entries={[]}
        isCollapsed={false}
        onToggleCollapse={() => {}}
      />,
    );
    expect(screen.getByText('No entries yet.')).toBeInTheDocument();
  });

  it('hides entry list when collapsed', () => {
    const entries = [makeEntry()];
    render(
      <LedgerSection
        ledger={makeLedger()}
        entries={entries}
        isCollapsed={true}
        onToggleCollapse={() => {}}
      />,
    );
    expect(screen.queryByText('Coffee at shop')).not.toBeInTheDocument();
    expect(screen.queryByText('No entries yet.')).not.toBeInTheDocument();
  });

  it('renders one EntryListItem per entry when expanded', () => {
    const entries = [
      makeEntry({ entry_id: 'e1', detail: 'Coffee', amount: 4.5 }),
      makeEntry({ entry_id: 'e2', detail: 'Market', amount: 30 }),
    ];
    render(
      <LedgerSection
        ledger={makeLedger()}
        entries={entries}
        isCollapsed={false}
        onToggleCollapse={() => {}}
      />,
    );
    expect(screen.getByText('Coffee')).toBeInTheDocument();
    expect(screen.getByText('Market')).toBeInTheDocument();
  });

  it('footer shows correct total credits', () => {
    const entries = [
      makeEntry({ entry_id: 'e1', amount: 10, cat_direction: 'add' }),
      makeEntry({ entry_id: 'e2', amount: 30, cat_direction: 'sub' }),
      makeEntry({ entry_id: 'e3', amount: 5, cat_direction: 'add' }),
    ];
    render(
      <LedgerSection
        ledger={makeLedger({ balance: 150 })}
        entries={entries}
        isCollapsed={false}
        onToggleCollapse={() => {}}
      />,
    );
    expect(screen.getByText('Total credits: 15.00')).toBeInTheDocument();
  });

  it('footer shows ledger balance', () => {
    const entries = [makeEntry()];
    render(
      <LedgerSection
        ledger={makeLedger({ balance: 200 })}
        entries={entries}
        isCollapsed={false}
        onToggleCollapse={() => {}}
      />,
    );
    expect(screen.getByText('Balance: +200.00')).toBeInTheDocument();
  });

  it('does not show footer when entries is empty', () => {
    render(
      <LedgerSection
        ledger={makeLedger()}
        entries={[]}
        isCollapsed={false}
        onToggleCollapse={() => {}}
      />,
    );
    expect(screen.queryByText(/Total credits/)).not.toBeInTheDocument();
  });
});
