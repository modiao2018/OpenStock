# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Retail investors (Chinese-first, English second) who watch US equities on their own time, mostly on a desktop browser at night Beijing time while the US market is open, and on a phone during the day. They come to check prices, alerts, catalysts, insider activity, and signals; they are not professionals and pay for nothing. (Inferred from the codebase and README; not yet confirmed by the owner.)

## Product Purpose

HappyStock is a free, open-source alternative to paid market platforms: real-time prices, watchlists, personalized alerts, a heatmap dashboard, catalyst calendar, AI dip picks, focus lists, and signals. Success is a user who logs in daily and trusts what they see. It is not a brokerage and gives no financial advice.

## Positioning

Everything a paid terminal gates behind a subscription, given away and self-hostable (AGPL). The mechanism is a monitor daemon that cross-checks SEC, ClinicalTrials.gov, Finnhub and Alpaca and emits signals the dashboard renders.

## Operating Context

Single production deployment at happystock.colvai.com (Next.js 15 standalone in Docker behind nginx and Cloudflare, MongoDB 7). Accounts are email + password via Better Auth; a password-reset email flow exists. Locale is stored in a cookie and switchable on every page including auth pages. Auth pages are the only public surface; everything else redirects to sign-in.

## Capabilities and Constraints

- Auth: email/password sign-in, sign-up with investment-profile fields (country, goals, risk tolerance, preferred industry), forgot/reset password. Sign-up is open.
- Confirmed 2026-09-05: sign-in, sign-up, and forgot-password all get a slide-to-fit puzzle captcha verified server-side, plus server-side rate limiting (per email and per IP) so brute-force is blocked even when the captcha is bypassed.
- Confirmed 2026-09-05: sign-up is gated by manual review. New accounts are `pending` and cannot sign in until an admin (an email listed in `ADMIN_EMAILS`) approves them on `/admin/users`. Admin emails are approved on creation. Accounts predating the feature are treated as approved.
- Stack: Next.js App Router, Tailwind v4, shadcn/ui + Radix, react-hook-form, next-intl (zh-CN default, en), sonner toasts, sharp available server-side.
- Terminology in product copy: "催化剂 / Catalyst", "信号 / Signals", "热力图 / Heatmap", "AI 抄底 / AI Dips", "关注 / Focus".

## Brand Commitments

- Name: HappyStock. Logo: `public/assets/images/logo.svg` (teal K-line smiling-eye mark plus wordmark). Brand accent teal `#0FEDBE` (`--color-teal-400`), near-black ground `#050505`.
- Dark UI throughout the product; the auth surface must read as the same product as the dashboard.
- Confirmed 2026-09-05 for the auth surface: an Apple-account-style premium look, one centered card, no side product-showcase panel.
- Contact email shown on auth pages: lxutong2026@gmail.com.

## Evidence on Hand

- Real market data flows through Finnhub/Alpaca/SEC/CT.gov; no testimonials, customer logos, or press exist and none may be invented.
- Auth copy lives in `messages/zh-CN.json` and `messages/en.json` under `auth`.

## Product Principles

1. Trust over flash: nothing on screen may imply data or claims the product does not have.
2. Zero friction for humans, real friction for scripts: every anti-abuse control must be solvable in seconds by a person on a phone.
3. Bilingual by default: every string ships in zh-CN and en with identical key trees (enforced by a test).
4. One product, one identity: brand teal on near-black everywhere; auth pages are not a separate marketing site.
