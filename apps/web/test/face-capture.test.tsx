// @vitest-environment jsdom
/**
 * The face capture itself, rendered for real — every page test mocks it away.
 *
 * Since 2026-11-25 it judges ONE frame, the one on screen when the button is pressed, by
 * contrast alone, and hands that same frame over at once. It used to demand movement between
 * two frames 350 ms apart: a blink never cleared that bar, and people tapped again and again.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FaceCapture } from '@/components/hr/face-capture';
import { id as idDict } from '@/lib/dictionaries/id';
import { LocaleProvider } from '@/lib/locale-context';

const T = idDict.hrFix.faceCapture;

/** Gray level of pixel i in what the camera shows; the test sets it per case. */
let frame: (i: number) => number = () => 0;
/** How many times the component sampled the camera. */
let samples = 0;

/** A camera whose stream the test can release when it wants. */
function camera() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  const stop = vi.fn();
  const getUserMedia = vi.fn(() => opened.then(() => ({ getTracks: () => [{ stop }] })));
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  return { open, stop, getUserMedia };
}

beforeEach(() => {
  frame = () => 0;
  samples = 0;
  // jsdom has no 2D canvas: answer with the frame the test describes, as RGBA.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
    drawImage: () => undefined,
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      samples += 1;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        const g = frame(i);
        data.set([g, g, g, 255], i * 4);
      }
      return { data };
    },
  })) as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return `data:image/jpeg;base64,${this.width}x${this.height}`;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

async function draw() {
  const onCapture = vi.fn();
  const cam = camera();
  const { unmount } = render(
    <LocaleProvider>
      <FaceCapture onCapture={onCapture} />
    </LocaleProvider>,
  );
  const button = screen.getByRole('button', { name: T.take });
  return { onCapture, cam, button, unmount };
}

describe('FaceCapture', () => {
  it('keeps the button off until the camera has opened', async () => {
    const { cam, button } = await draw();
    expect(button).toBeDisabled();
    cam.open();
    await waitFor(() => expect(button).toBeEnabled());
    expect(cam.getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'user' }, audio: false });
  });

  it('hands over the frame on screen the moment the button is pressed, judged usable', async () => {
    const { cam, button, onCapture } = await draw();
    cam.open();
    await waitFor(() => expect(button).toBeEnabled());
    // A face in front of a wall: half dark, half light.
    frame = (i) => (i % 2 === 0 ? 40 : 200);

    await userEvent.click(button);

    // At once, not after a wait: one sample, one capture.
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith('data:image/jpeg;base64,480x480', true);
    expect(samples).toBe(1);
  });

  it('accepts a face held perfectly still — no movement is asked for any more', async () => {
    const { cam, button, onCapture } = await draw();
    cam.open();
    await waitFor(() => expect(button).toBeEnabled());
    // The identical frame on every read: the old gate measured zero motion and refused it.
    frame = (i) => 60 + ((i * 37) % 120);

    await userEvent.click(button);

    expect(onCapture).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/jpeg/), true);
  });

  it('marks a black or covered frame unusable, so the page can ask for a retake', async () => {
    const { cam, button, onCapture } = await draw();
    cam.open();
    await waitFor(() => expect(button).toBeEnabled());
    frame = () => 3;

    await userEvent.click(button);

    expect(onCapture).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/jpeg/), false);
  });

  it('can be pressed again after an unusable frame', async () => {
    const { cam, button, onCapture } = await draw();
    cam.open();
    await waitFor(() => expect(button).toBeEnabled());

    frame = () => 0;
    await userEvent.click(button);
    frame = (i) => (i % 2 === 0 ? 40 : 200);
    await userEvent.click(button);

    expect(onCapture.mock.calls.map(([, usable]) => usable)).toEqual([false, true]);
  });

  it('tells the person to look at the camera and hold still', async () => {
    await draw();
    expect(screen.getByText(T.hint)).toBeTruthy();
    expect(T.hint).not.toMatch(/kedip|gerakkan/i);
  });

  it('stops the camera when it goes away', async () => {
    const { cam, button, unmount } = await draw();
    cam.open();
    await waitFor(() => expect(button).toBeEnabled());
    expect(cam.stop).not.toHaveBeenCalled();
    unmount();
    expect(cam.stop).toHaveBeenCalledTimes(1);
  });
});
