'use client';

import { useAuth } from '@/lib/auth-context';
import { useLocation } from '@/lib/location-context';
import { useT } from '@/lib/locale-context';
import { endpoints } from '@/lib/endpoints';
import { Hero } from '@/components/hero';
import { PromoCarousel } from '@/components/promo-carousel';
import { CategoryGrid } from '@/components/category-grid';
import { NearbyDepots } from '@/components/nearby-depots';
import { LoyaltyHighlight } from '@/components/loyalty-highlight';
import { ActiveOrderCard } from '@/components/active-order-card';
import { ProductRecRail } from '@/components/product-rec-rail';

// Personalized customer Home at `/`. Same route, two emphases branched by auth:
// returning users lead with reorder + live order status (habitual repurchase is
// the #1 lever); guests lead with the value prop + coverage answer, then
// discovery. Every data section hides when empty (see the child components), so
// the page degrades gracefully before the catalog/orders are populated. The
// depot card carries the trust row for both branches.

export default function HomePage() {
  const { customer } = useAuth();
  const { location } = useLocation();
  const { t } = useT();

  // Depot-scope best-sellers to the chosen location when known.
  const trending = endpoints.recommendations.trending(
    location?.depotId ? { depotId: location.depotId } : {},
  );

  const membershipAndDepot = (
    <div className="grid gap-4 lg:grid-cols-2">
      <LoyaltyHighlight />
      <NearbyDepots />
    </div>
  );

  return (
    <div className="flex flex-col gap-[46px]">
      {customer ? (
        <>
          <div className="flex flex-col gap-3.5">
            <Hero greetingName={customer.fullName} />
            <ActiveOrderCard />
          </div>
          <ProductRecRail
            title={t('home.rail.reorder')}
            subtitle={t('home.rail.reorderSub')}
            endpoint={endpoints.recommendations.reorder()}
            requiresAuth
          />
          <PromoCarousel />
          <CategoryGrid />
          <ProductRecRail title={t('home.rail.trending')} endpoint={trending} />
          {membershipAndDepot}
        </>
      ) : (
        <>
          <Hero />
          <PromoCarousel />
          <CategoryGrid />
          <ProductRecRail title={t('home.rail.trending')} endpoint={trending} />
          {membershipAndDepot}
        </>
      )}
    </div>
  );
}
