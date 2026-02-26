import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BookCard from '../src/components/BookCard.js';
import type { Book } from '@ledger/shared';

function makeBook(overrides: Partial<Book & { ledger_count: number }> = {}): Book & { ledger_count: number } {
  return {
    book_id: 'book-test-1',
    name: 'Test Book',
    is_closed: 0,
    is_balanced: 0,
    is_auto_open: 0,
    status: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: null,
    ledger_count: 3,
    ...overrides,
  };
}

describe('BookCard', () => {
  it('renders book name', () => {
    render(<BookCard book={makeBook({ name: 'My Finances' })} onClick={() => {}} />);
    expect(screen.getByText('My Finances')).toBeInTheDocument();
  });

  it('renders ledger count text', () => {
    render(<BookCard book={makeBook({ ledger_count: 5 })} onClick={() => {}} />);
    expect(screen.getByText('5 ledgers')).toBeInTheDocument();
  });

  it('renders singular ledger count when count is 1', () => {
    render(<BookCard book={makeBook({ ledger_count: 1 })} onClick={() => {}} />);
    expect(screen.getByText('1 ledger')).toBeInTheDocument();
  });

  it('shows Closed badge when is_closed is 1', () => {
    render(<BookCard book={makeBook({ is_closed: 1 })} onClick={() => {}} />);
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });

  it('does not show Closed badge when book is open', () => {
    render(<BookCard book={makeBook({ is_closed: 0 })} onClick={() => {}} />);
    expect(screen.queryByText('Closed')).not.toBeInTheDocument();
  });

  it('shows Balanced badge when is_balanced is 1', () => {
    render(<BookCard book={makeBook({ is_balanced: 1 })} onClick={() => {}} />);
    expect(screen.getByText('Balanced')).toBeInTheDocument();
  });

  it('does not show Balanced badge when is_balanced is 0', () => {
    render(<BookCard book={makeBook({ is_balanced: 0 })} onClick={() => {}} />);
    expect(screen.queryByText('Balanced')).not.toBeInTheDocument();
  });

  it('calls onClick when card is clicked', async () => {
    const user = userEvent.setup();
    const handleClick = jest.fn();
    render(<BookCard book={makeBook()} onClick={handleClick} />);
    await user.click(screen.getByText('Test Book'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
