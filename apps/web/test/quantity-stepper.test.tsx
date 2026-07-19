// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { QuantityStepper } from '@/components/quantity-stepper';

describe('QuantityStepper', () => {
  it('renders the current value', () => {
    render(<QuantityStepper value={3} onChange={() => {}} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('increments and decrements via the buttons', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<QuantityStepper value={2} onChange={onChange} />);

    await userEvent.click(screen.getByLabelText('Increase quantity'));
    expect(onChange).toHaveBeenLastCalledWith(3);

    rerender(<QuantityStepper value={2} onChange={onChange} />);
    await userEvent.click(screen.getByLabelText('Decrease quantity'));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it('clamps at min and disables the minus button there', async () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={1} min={1} onChange={onChange} />);
    const minus = screen.getByLabelText('Decrease quantity');
    expect(minus).toBeDisabled();
    await userEvent.click(minus);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clamps at max and disables the plus button there', async () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={5} max={5} onChange={onChange} />);
    const plus = screen.getByLabelText('Increase quantity');
    expect(plus).toBeDisabled();
    await userEvent.click(plus);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables both buttons when disabled', () => {
    render(<QuantityStepper value={3} disabled onChange={() => {}} />);
    expect(screen.getByLabelText('Decrease quantity')).toBeDisabled();
    expect(screen.getByLabelText('Increase quantity')).toBeDisabled();
  });
});
