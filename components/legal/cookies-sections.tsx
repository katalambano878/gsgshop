import React from 'react';
import type { LegalSection } from './LegalDoc';

/**
 * Source: https://www.gsgbrands.com.gh/cookies (Effective 11 May 2026).
 * Sole source of truth for the cookie text across goods and shopper.
 */
export const COOKIES_INTRO: React.ReactNode = (
  <>
    How GSG Brands uses cookies and similar technologies on gsgbrands.com.gh
    and our related service domains — alongside the choices you have to manage
    them.
  </>
);

export const COOKIES_SECTIONS: LegalSection[] = [
  {
    id: 'about',
    num: '01',
    title: 'About this policy',
    body: (
      <p>
        This Cookie Policy explains how GSG Brands uses cookies and similar
        technologies on{' '}
        <a href="https://gsgbrands.com.gh/" target="_blank" rel="noreferrer">
          gsgbrands.com.gh
        </a>{' '}
        and our related service domains. It should be read together with our{' '}
        <a href="/privacy-policy">Privacy Policy</a>.
      </p>
    ),
  },
  {
    id: 'what-cookies-are',
    num: '02',
    title: 'What cookies are',
    body: (
      <p>
        Cookies are small text files that a website stores on your device when
        you visit it. They are widely used to make websites work efficiently,
        remember preferences, and provide information to the site owner. We
        also use similar technologies such as pixels, local storage, and web
        beacons. For simplicity we refer to all of these as
        &ldquo;cookies&rdquo;.
      </p>
    ),
  },
  {
    id: 'why-we-use',
    num: '03',
    title: 'Why we use cookies',
    body: (
      <>
        <p>We use cookies to:</p>
        <ul>
          <li>keep you signed in across pages and visits;</li>
          <li>remember items in your cart, language preference, and recent activity;</li>
          <li>secure your session against tampering and abuse;</li>
          <li>measure how the site is used so we can improve speed, reliability, and content;</li>
          <li>show you relevant information across our platform.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'third-party-cookies',
    num: '04',
    title: 'Third-party cookies',
    body: (
      <p>
        Some cookies are set by third parties we work with — for example,
        hosting providers, analytics tools, payment processors, and
        customer-support widgets. Their use of cookies is governed by their own
        privacy and cookie policies; please consult them directly.
      </p>
    ),
  },
  {
    id: 'managing-cookies',
    num: '05',
    title: 'Managing cookies',
    body: (
      <>
        <p>You can manage cookies in several ways:</p>
        <ul>
          <li><strong>Browser settings</strong> — most browsers let you accept, reject, or delete cookies, either entirely or per site.</li>

          <li><strong>Device controls</strong> — mobile operating systems offer their own ad-tracking and analytics controls.</li>
        </ul>
        <p>Disabling cookies may affect the functionality of parts of the Services.</p>
      </>
    ),
  },
  {
    id: 'changes',
    num: '06',
    title: 'Changes',
    body: (
      <p>
        We may update this Cookie Policy from time to time. Material changes
        will be notified through our usual channels.
      </p>
    ),
  },
  {
    id: 'contact',
    num: '07',
    title: 'Contact',
    body: (
      <p>
        For questions about cookies on our platforms, please contact{' '}
        <a href="mailto:info@gsgbrands.com.gh">info@gsgbrands.com.gh</a>.
      </p>
    ),
  },
];
