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

  describe('editable', () => {
    it('keeps the plain read-only number when not editable', () => {
      render(<QuantityStepper value={3} onChange={() => {}} />);
      expect(screen.queryByLabelText('Quantity')).toBeNull();
    });

    it('commits a typed number on Enter, not on every keystroke', async () => {
      const onChange = vi.fn();
      render(<QuantityStepper editable value={0} min={0} max={50} onChange={onChange} />);
      const box = screen.getByLabelText('Quantity');
      await userEvent.click(box);
      await userEvent.keyboard('20');
      expect(onChange).not.toHaveBeenCalled();
      await userEvent.keyboard('{Enter}');
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenLastCalledWith(20);
    });

    it('commits on blur', async () => {
      const onChange = vi.fn();
      render(<QuantityStepper editable value={0} min={0} max={50} onChange={onChange} />);
      await userEvent.click(screen.getByLabelText('Quantity'));
      await userEvent.keyboard('7');
      await userEvent.tab();
      expect(onChange).toHaveBeenLastCalledWith(7);
    });

    it('clamps a number above the ceiling to the ceiling', async () => {
      const onChange = vi.fn();
      render(<QuantityStepper editable value={0} min={0} max={12} onChange={onChange} />);
      await userEvent.click(screen.getByLabelText('Quantity'));
      await userEvent.keyboard('99{Enter}');
      expect(onChange).toHaveBeenLastCalledWith(12);
    });

    it('takes digits only', async () => {
      const onChange = vi.fn();
      render(<QuantityStepper editable value={0} min={0} max={50} onChange={onChange} />);
      await userEvent.click(screen.getByLabelText('Quantity'));
      await userEvent.keyboard('1a-2.{Enter}');
      expect(onChange).toHaveBeenLastCalledWith(12);
    });

    it('treats an emptied box as the minimum', async () => {
      const onChange = vi.fn();
      render(<QuantityStepper editable value={5} min={0} max={50} onChange={onChange} />);
      await userEvent.click(screen.getByLabelText('Quantity'));
      await userEvent.keyboard('{Backspace}{Enter}');
      expect(onChange).toHaveBeenLastCalledWith(0);
    });

    it('does not call back when the typed number is the current one', async () => {
      const onChange = vi.fn();
      render(<QuantityStepper editable value={5} min={0} max={50} onChange={onChange} />);
      await userEvent.click(screen.getByLabelText('Quantity'));
      await userEvent.keyboard('5{Enter}');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('drops what was typed on Escape', async () => {
      const onChange = vi.fn();
      render(<QuantityStepper editable value={5} min={0} max={50} onChange={onChange} />);
      const box = screen.getByLabelText('Quantity') as HTMLInputElement;
      await userEvent.click(box);
      await userEvent.keyboard('9{Escape}');
      expect(box.value).toBe('5');
      await userEvent.tab();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('follows the value when the buttons change it', async () => {
      const { rerender } = render(<QuantityStepper editable value={5} min={0} max={50} onChange={() => {}} />);
      rerender(<QuantityStepper editable value={6} min={0} max={50} onChange={() => {}} />);
      expect((screen.getByLabelText('Quantity') as HTMLInputElement).value).toBe('6');
    });

    it('names the box for the product it belongs to', () => {
      render(<QuantityStepper editable label="Quantity: Air Galon" value={1} onChange={() => {}} />);
      expect(screen.getByLabelText('Quantity: Air Galon')).toBeInTheDocument();
    });

    it('is inert when disabled', () => {
      render(<QuantityStepper editable disabled value={5} onChange={() => {}} />);
      expect(screen.getByLabelText('Quantity')).toBeDisabled();
    });
  });
});
