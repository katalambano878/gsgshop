import { permanentRedirect } from 'next/navigation';

// The shared footer links to /privacy; on the shopper host the page lives at /privacy-policy.
export default function ShopperPrivacyAlias() {
  permanentRedirect('/shopper/privacy-policy');
}
