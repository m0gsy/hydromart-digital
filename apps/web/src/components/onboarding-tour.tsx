'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Drop, MapPin, Truck } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

import { useT } from '@/lib/locale-context';
import { onboarding as tourID } from '@/lib/dictionaries/id/onboarding';
import { onboarding as tourEN } from '@/lib/dictionaries/en/onboarding';
import { BrandMark } from '@/components/ui';

const SEEN_KEY = 'hydromart.onboarded';
const ICONS: Record<string, Icon> = { MapPin, Drop, Truck };

// First-run product tour (spec 7a). Shows once, gated on localStorage — pure
// client, no auth, no backend. ponytail: a single "seen" flag; skip and finish
// both set it, so it never reappears.
export function OnboardingTour() {
  const { locale, t } = useT();
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!localStorage.getItem(SEEN_KEY)) setShow(true);
  }, []);

  /**
   * E10 — Escape closes the tour, which is what makes the hardware back button close it.
   *
   * `native-bridge.tsx` answers a back press by dispatching Escape at anything carrying
   * `aria-modal="true"`, then stopping. Every other overlay here already closes on Escape,
   * so that one rule covers them all without naming any. This listener and the
   * `aria-modal` below are two halves of one fix: the attribute alone would stop back from
   * navigating and give it nothing to do instead — a dead button rather than a wrong one.
   *
   * Registered whenever the tour is up, and dismissing counts as "seen", exactly like
   * Lewati. A tour that reappears on the next screen is the annoyance the flag exists for.
   */
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      localStorage.setItem(SEEN_KEY, '1');
      setShow(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [show]);

  if (!show) return null;

  const slides = (locale === 'en' ? tourEN : tourID).slides;
  const slide = slides[step];
  if (!slide) return null;
  const last = step === slides.length - 1;
  const Ic = ICONS[slide.icon] ?? Drop;

  function dismiss() {
    localStorage.setItem(SEEN_KEY, '1');
    setShow(false);
  }

  return (
    <div
      // E10. `aria-modal` is what `native-bridge.tsx` looks for when deciding whether a
      // back press means "close this" or "go back a page" — and it is also what tells a
      // screen reader the page behind is inert. `aria-labelledby` points at the slide
      // title so the dialog announces as something rather than as "dialog".
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[color:var(--text)]/40 p-4 backdrop-blur-sm"
    >
      <div className="flex min-h-[560px] w-full max-w-[340px] flex-col rounded-3xl surface p-6 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
        <div className="flex items-center justify-between">
          <BrandMark circlePx={30} dropPx={16} textClass="text-[15px]" className="gap-2" />
          <button type="button" onClick={dismiss} className="text-[12.5px] font-bold text-muted hover:text-[color:var(--text)]">
            {t('onboarding.skip')}
          </button>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <span className="flex h-[120px] w-[120px] items-center justify-center rounded-[32px] bg-brand-50">
            <Ic size={60} weight="fill" className="text-brand-600" />
          </span>
          <div id="onboarding-title" className="text-[22px] font-extrabold tracking-[-0.02em]">
            {slide.title}
          </div>
          <div className="max-w-[250px] text-sm leading-relaxed text-muted">{slide.body}</div>
        </div>

        {/* dots */}
        <div className="mb-4 flex items-center justify-center gap-1.5">
          {slides.map((_, i) => (
            <span
              key={i}
              className={`h-[7px] rounded-full transition-all ${i === step ? 'w-[22px] bg-brand-600' : 'w-[7px] bg-[color:var(--border)]'}`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => (last ? dismiss() : setStep((s) => s + 1))}
          className="flex h-[52px] items-center justify-center gap-2 rounded-[14px] bg-brand-600 text-[15px] font-extrabold text-on-brand transition-colors hover:bg-brand-800"
        >
          {last ? t('onboarding.start') : t('onboarding.next')}
          {!last && <ArrowRight size={16} weight="bold" />}
        </button>
      </div>
    </div>
  );
}
