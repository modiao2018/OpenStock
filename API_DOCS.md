<div align="center">
  <img src="public/assets/images/logo.svg" alt="HappyStock Logo" width="120" />
  <h1>HappyStock API & Architecture</h1>
  
  <p>
    <b>Modern. Open. Resilient.</b>
  </p>

  <p>
    <img src="https://img.shields.io/badge/status-active-success?style=for-the-badge" alt="Status" />
    <img src="https://img.shields.io/badge/AI-Gemini%20%2B%20Siray-blueviolet?style=for-the-badge" alt="AI Stack" />
    <img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=for-the-badge" alt="License" />
  </p>
</div>

---

## 🏗️ Architecture Overview

HappyStock leverages a resilient event-driven architecture powered by **Inngest**. We prioritize uptime for our generative features by utilizing a multi-provider AI strategy.

### 🧠 Intelligent Model Routing

We don't rely on a single point of failure. Our AI infrastructure automatically routes around outages.

```mermaid
graph LR
    A[User Action / Cron] -->|Trigger| B(Inngest Function);
    B --> C{Primary Provider};
    C -->|Gemini 2.5 Flash Lite| D[Generate Content];
    C -.->|Error / Rate Limit| E{Fallback Provider};
    E -->|Siray.ai Ultra| D;
    D --> F[Email / Notification];
    
    style C fill:#20c997,stroke:#333,stroke-width:2px,color:black
    style E fill:#3b82f6,stroke:#333,stroke-width:2px,color:white
    style D fill:#fff,stroke:#333,stroke-width:2px,color:black
```

---

## 🤝 AI Partners

### Primary: Google Gemini
The workhorse of our generative content. Fast, efficient, and deeply integrated via Inngest.

### Fallback: Siray.ai
> [!IMPORTANT]
> **Zero Downtime Guarantee.**
> When Gemini wavers, **Siray.ai** takes over instantly. No user request is ever dropped.

<div align="center">
  <br/>
  <a href="https://www.siray.ai/">
    <img src="public/assets/icons/siray.svg" alt="Siray.ai Logo" width="180" />
  </a>
  <p><i>The robust infrastructure backing HappyStock.</i></p>
</div>

---

## ⚡ Serverless Functions (Inngest)

Our background jobs are defined in `lib/inngest/functions.ts`.

| ID | Type | Schedule/Trigger | Purpose |
| :--- | :--- | :--- | :--- |
| `sign-up-email` | 🔔 Event | `app/user.created` | **Personalized Onboarding.** Generates a custom welcome message based on user quiz results. |
| `weekly-news-summary` | ⏱️ Cron | `0 9 * * 1` (Mon 9AM) | **Market Intelligence.** Summarizes top financial news and broadcasts to all users via Kit. |
| `check-stock-alerts` | ⏱️ Cron | `*/5 * * * *` | **Real-time Monitoring.** Checks user price targets against live market data. |
| `check-inactive-users` | ⏱️ Cron | `0 10 * * *` | **Re-engagement.** Identifies dormant users (>30 days) and sends a "We miss you" nudge. |

---

## 🔌 API Integrations

<details>
<summary><b>📈 Stock Data: Finnhub</b></summary>
<br/>

*   **Base URL:** `https://finnhub.io/api/v1`
*   **Key Features:** Real-time quotes, technical indicators, market news, recommendation trend, earnings surprises.
*   **Auth:** `NEXT_PUBLIC_FINNHUB_API_KEY`

</details>

<details>
<summary><b>🏛️ Insider Filings & Fundamentals: SEC EDGAR</b></summary>
<br/>

*   **Endpoints:** `files/company_tickers.json` (ticker → CIK), `data.sec.gov/submissions/CIK….json` (filing index), `Archives/edgar/data/…/form4.xml` (raw Form 4), `data.sec.gov/api/xbrl/companyfacts/CIK….json` (XBRL facts).
*   **Key Features:** Insider transactions with transaction codes and 10b5-1 flag, quarterly revenue / net income / EPS / cash flow as reported, links to 8-K, 10-Q, 10-K, 13D/G.
*   **Auth:** none. Set `EDGAR_CONTACT` (SEC fair-access policy). Code: `lib/edgar.ts` (shared with the catalyst-monitor daemon) and `lib/actions/edgar.actions.ts`.

</details>

<details>
<summary><b>🎯 Analyst Research: Yahoo Finance + Nasdaq</b></summary>
<br/>

*   **Yahoo:** `query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}` with modules `financialData`, `recommendationTrend`, `upgradeDowngradeHistory`, `earningsTrend`, `institutionOwnership`, `majorHoldersBreakdown`, `calendarEvents`. Requires a cookie + crumb session that is bootstrapped and cached in-process.
*   **Nasdaq:** `api.nasdaq.com/api/analyst/{symbol}/targetprice` as a second opinion on the mean price target.
*   **Auth:** none. Code: `lib/actions/analyst.actions.ts`.

</details>

<details>
<summary><b>📧 Email & Marketing: Kit (ConvertKit)</b></summary>
<br/>

*   **Role:** High-volume user broadcasts and tag management.
*   **Key Endpoints:**
    *   `POST /v3/tags/{tag_id}/subscribe` (User Migration)
    *   `POST /v3/broadcasts` (Newsletters)
*   **Auth:** `KIT_API_KEY` • `KIT_API_SECRET`

</details>

<details>
<summary><b>🗄️ Database: MongoDB Atlas</b></summary>
<br/>

*   **Connection:** Standard URI (DNS SRV bypassed for maximum reliability).
*   **Collections:** `users`, `watchlists`, `alerts`.

</details>

---

<div align="center">
  <sub>Documentation © Open Dev Society. Built with ❤️ for the Open Source Community.</sub>
</div>
