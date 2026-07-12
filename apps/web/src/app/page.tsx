'use client';

import { useAuth } from '@/lib/auth-context';
import { useLocation } from '@/lib/location-context';
import { useT } from '@/lib/locale-context';
import { endpoints } from '@/lib/endpoints';
import { Hero } from '@/components/hero';
import { PromoCarousel } from '@/components/promo-carousel';
import { CategoryGrid } from '@/components/category-grid';
import { NearbyDepots } from '@/components/nearby-depots';
import { TrustIndicators } from '@/components/trust-indicators';
import { LoyaltyHighlight } from '@/components/loyalty-highlight';
import { ActiveOrderCard } from '@/components/active-order-card';
import { ProductRecRail } from '@/components/product-rec-rail';

// Personalized customer Home at `/`. Same route, two emphases branched by auth:
// returning users lead with reorder + live order status (habitual repurchase is
// the #1 lever); guests lead with the value prop + coverage answer, then
// discovery. Every data section hides when empty (see the child components), so
// the page degrades gracefully before the catalog/orders are populated.

export default function HomePage() {
  const { customer } = useAuth();
  const { location } = useLocation();
  const { t } = useT();

  // Depot-scope best-sellers to the chosen location when known.
  const trending = endpoints.recommendations.trending(
    location?.depotId ? { depotId: location.depotId } : {},
  );

  return (
    <div className="flex flex-col gap-8">
      <Hero greetingName={customer?.fullName} />

      {customer ? (
        <>
          <ActiveOrderCard />
          <ProductRecRail title={t('home.rail.reorder')} endpoint={endpoints.recommendations.reorder()} requiresAuth />
          <PromoCarousel />
          <CategoryGrid />
          <ProductRecRail title={t('home.rail.trending')} endpoint={trending} />
          <LoyaltyHighlight />
          <NearbyDepots />
          <TrustIndicators />
        </>
      ) : (
        <>
          <PromoCarousel />
          <CategoryGrid />
          <ProductRecRail title={t('home.rail.trending')} endpoint={trending} />
          <TrustIndicators />
          <LoyaltyHighlight />
          <NearbyDepots />
        </>
      )}
    </div>
  );
}
