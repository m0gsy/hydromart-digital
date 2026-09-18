// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ExternalLink } from '@/components/external-link';

// WEBB-1: a typed receipt URL is rendered through this component, so only real link
// schemes may become an anchor.
describe('ExternalLink', () => {
  afterEach(cleanup);
  it.each(['https://nos.example/pod/a.jpg', 'tel:0812', 'mailto:a@b.c'])('links %s', (href) => {
    render(<ExternalLink href={href}>go</ExternalLink>);
    expect(screen.getByText('go').closest('a')?.getAttribute('href')).toBe(href);
  });

  it.each(['javascript:alert(1)', 'data:text/html,<b>x', 'x', 'intent://evil'])(
    'renders %s as text, not a link',
    (href) => {
      render(<ExternalLink href={href}>receipt</ExternalLink>);
      expect(screen.getByText('receipt').closest('a')).toBeNull();
    },
  );
});
