export const WELCOME_EMAIL_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="format-detection" content="telephone=no">
    <meta name="x-apple-disable-message-reformatting">
    <title>欢迎加入 OpenStock</title>
    <!--[if mso]>
    <noscript>
        <xml>
            <o:OfficeDocumentSettings>
                <o:AllowPNG/>
                <o:PixelsPerInch>96</o:PixelsPerInch>
            </o:OfficeDocumentSettings>
        </xml>
    </noscript>
    <![endif]-->
    <style type="text/css">
        /* Dark mode styles */
        @media (prefers-color-scheme: dark) {
            .email-container {
                background-color: #141414 !important;
                border: 1px solid #30333A !important;
            }
            .dark-bg {
                background-color: #050505 !important;
            }
            .dark-text {
                color: #ffffff !important;
            }
            .dark-text-secondary {
                color: #9ca3af !important;
            }
            .dark-text-muted {
                color: #6b7280 !important;
            }
            .dark-border {
                border-color: #30333A !important;
            }
        }

        @media only screen and (max-width: 600px) {
            .email-container {
                width: 100% !important;
                margin: 0 !important;
            }
            .mobile-padding {
                padding: 24px !important;
            }
            .mobile-header-padding {
                padding: 24px 24px 12px 24px !important;
            }
            .mobile-text {
                font-size: 14px !important;
                line-height: 1.5 !important;
            }
            .mobile-title {
                font-size: 24px !important;
                line-height: 1.3 !important;
            }
            .mobile-button {
                width: 100% !important;
                text-align: center !important;
            }
            .mobile-button a {
                width: calc(100% - 64px) !important;
                display: block !important;
                text-align: center !important;
            }
            .mobile-outer-padding {
                padding: 20px 10px !important;
            }
            .dashboard-preview {
                padding: 0 15px 30px 15px !important;
            }
        }
        @media only screen and (max-width: 480px) {
            .mobile-title {
                font-size: 22px !important;
            }
            .mobile-padding {
                padding: 15px !important;
            }
            .mobile-header-padding {
                padding: 15px 15px 8px 15px !important;
            }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: #050505; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #050505;">
        <tr>
            <td align="center" class="mobile-outer-padding" style="padding: 40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-container" style="max-width: 600px; background-color: #141414; border-radius: 8px; border: 1px solid #30333A;">

                    <!-- Header with Logo -->
                    <tr>
                        <td align="left" class="mobile-header-padding" style="padding: 40px 40px 20px 40px;">
                            <img src="https://i.ibb.co/r28VWPjS/Screenshot-2025-10-04-123317-Picsart-Ai-Image-Enhancer-removebg-preview.png" alt="OpenStock Logo" width="150" style="max-width: 100%; height: auto;">
                        </td>
                    </tr>

                    <!-- Dashboard Preview Image -->
                    <tr>
                        <td align="center" class="dashboard-preview" style="padding: 40px 40px 0px 40px;">
                            <img src="https://i.ibb.co/BKC2HBBQ/dashboard.png" alt="OpenStock Dashboard Preview" width="100%" style="max-width: 520px; width: 100%; height: auto; border-radius: 12px; border: 1px solid #30333A;">
                        </td>
                    </tr>

                    <!-- Main Content -->
                    <tr>
                        <td class="mobile-padding" style="padding: 40px 40px 40px 40px;">

                            <!-- Welcome Heading -->
                            <h1 class="mobile-title dark-text" style="margin: 0 0 30px 0; font-size: 24px; font-weight: 600; color: #FDD458; line-height: 1.2;">
                                欢迎加入，{{name}}
                            </h1>

                            <!-- Intro Text -->
                            {{intro}}

                            <!-- Feature List Label -->
                            <p class="mobile-text dark-text-secondary" style="margin: 0 0 15px 0; font-size: 16px; line-height: 1.6; color: #CCDADC; font-weight: 600;">
                                你现在就可以：
                            </p>

                            <!-- Feature List -->
                            <ul class="mobile-text dark-text-secondary" style="margin: 0 0 30px 0; padding-left: 20px; font-size: 16px; line-height: 1.6; color: #CCDADC;">
                                <li style="margin-bottom: 12px;">创建自选股，随时关注你喜欢的股票</li>
                                <li style="margin-bottom: 12px;">设置价格和成交量提醒，不错过任何行情波动</li>
                                <li style="margin-bottom: 12px;">在仪表盘查看走势和最新市场新闻</li>
                            </ul>

                            <!-- Additional Text -->
                            <p class="mobile-text dark-text-secondary" style="margin: 0 0 40px 0; font-size: 16px; line-height: 1.6; color: #CCDADC;">
                                我们会及时为你推送市场动态、洞察和提醒，让你专注于做出正确的决策。
                            </p>

                            <!-- CTA Button -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 0 40px 0; width: 100%;">
                                <tr>
                                    <td align="center">
                                        <a href="https://openstock-ods.vercel.app/" style="display: block; width: 100%; background: linear-gradient(135deg, #FDD458 0%, #E8BA40 100%); color: #000000; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-size: 16px; font-weight: 500; line-height: 1; text-align: center; box-sizing: border-box;">
                                            前往仪表盘
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <!-- Footer Text -->
                            <p class="mobile-text dark-text-muted" style="margin: 40px 0 0 0; font-size: 14px; line-height: 1.5; color: #CCDADC !important; text-align: center;">
                               由 Open Dev Society 发起<br>
                                <a href="#" style="color: #CCDADC !important; text-decoration: underline;">退订</a> |
                                <a href="https://stock-market-dev.vercel.app/" style="color: #CCDADC !important; text-decoration: underline;">访问 OpenStock</a><br>
                                © 2025 Open Dev Society
                            </p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

export const NEWS_SUMMARY_EMAIL_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="format-detection" content="telephone=no">
    <meta name="x-apple-disable-message-reformatting">
    <title>今日市场新闻摘要</title>
    <!--[if mso]>
    <noscript>
        <xml>
            <o:OfficeDocumentSettings>
                <o:AllowPNG/>
                <o:PixelsPerInch>96</o:PixelsPerInch>
            </o:OfficeDocumentSettings>
        </xml>
    </noscript>
    <![endif]-->
    <style type="text/css">
        /* Dark mode styles */
        @media (prefers-color-scheme: dark) {
            .email-container {
                background-color: #141414 !important;
                border: 1px solid #30333A !important;
            }
            .dark-bg {
                background-color: #050505 !important;
            }
            .dark-text {
                color: #ffffff !important;
            }
            .dark-text-secondary {
                color: #9ca3af !important;
            }
            .dark-text-muted {
                color: #6b7280 !important;
            }
            .dark-border {
                border-color: #30333A !important;
            }
            .dark-cta {
                background-color: #1f2937 !important;
                border: 1px solid #374151 !important;
            }
        }

        @media only screen and (max-width: 600px) {
            .email-container {
                width: 100% !important;
                margin: 0 !important;
            }
            .mobile-padding {
                padding: 24px !important;
            }
            .mobile-header-padding {
                padding: 24px 24px 12px 24px !important;
            }
            .mobile-text {
                font-size: 14px !important;
                line-height: 1.5 !important;
            }
            .mobile-title {
                font-size: 24px !important;
                line-height: 1.3 !important;
            }
            .mobile-news-title {
                font-size: 16px !important;
                line-height: 1.3 !important;
            }
            .mobile-outer-padding {
                padding: 20px 10px !important;
            }
        }
        @media only screen and (max-width: 480px) {
            .mobile-title {
                font-size: 22px !important;
            }
            .mobile-padding {
                padding: 15px !important;
            }
            .mobile-header-padding {
                padding: 15px 15px 8px 15px !important;
            }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: #050505; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #050505;">
        <tr>
            <td align="center" class="mobile-outer-padding" style="padding: 40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-container" style="max-width: 600px; background-color: #141414; border-radius: 8px; border: 1px solid #30333A;">

                    <!-- Header with Logo -->
                    <tr>
                        <td align="left" class="mobile-header-padding" style="padding: 40px 40px 20px 40px;">
                            <img src="https://i.ibb.co/r28VWPjS/Screenshot-2025-10-04-123317-Picsart-Ai-Image-Enhancer-removebg-preview.png" alt="Openstock Logo" width="150" style="max-width: 100%; height: auto;">
                        </td>
                    </tr>

                    <!-- Main Content -->
                    <tr>
                        <td class="mobile-padding" style="padding: 40px 40px 40px 40px;">

                            <!-- Header -->
                            <h1 class="mobile-title dark-text" style="margin: 0 0 20px 0; font-size: 24px; font-weight: 600; color: #FDD458; line-height: 1.2;">
                                今日市场新闻摘要
                            </h1>

                            <!-- Date -->
                            <p class="mobile-text dark-text-muted" style="margin: 0 0 30px 0; font-size: 14px; line-height: 1.4; color: #6b7280;">
                                {{date}}
                            </p>

                            <!-- News Summary -->
                            {{newsContent}}

                            <!-- Footer Text -->
                            <div style="text-align: center; margin: 40px 0 0 0;">
                                <p style="margin: 0 0 10px 0; font-size: 14px; line-height: 1.5; color: #CCDADC !important;">
                                    你收到这封邮件，是因为你订阅了 OpenStock 的资讯更新。
                                </p>
                                <p style="margin: 0 0 10px 0; font-size: 14px; line-height: 1.5; color: #CCDADC !important;">
                                    <a href="#" style="color: #CCDADC !important; text-decoration: underline;">退订</a> |
                                    <a href="https://openstock.vercel.app" style="color: #CCDADC !important; text-decoration: underline;">访问 OpenStock</a>
                                </p>
                                <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #CCDADC !important;">
                                    © 2025 Open Dev Society
                                </p>
                            </div>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

export const STOCK_ALERT_UPPER_EMAIL_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="format-detection" content="telephone=no">
    <meta name="x-apple-disable-message-reformatting">
    <title>价格提醒：{{symbol}} 触及上限目标价</title>
    <!--[if mso]>
    <noscript>
        <xml>
            <o:OfficeDocumentSettings>
                <o:AllowPNG/>
                <o:PixelsPerInch>96</o:PixelsPerInch>
            </o:OfficeDocumentSettings>
        </xml>
    </noscript>
    <![endif]-->
    <style type="text/css">
        /* Dark mode styles */
        @media (prefers-color-scheme: dark) {
            .email-container {
                background-color: #141414 !important;
                border: 1px solid #30333A !important;
            }
            .dark-bg {
                background-color: #050505 !important;
            }
            .dark-text {
                color: #ffffff !important;
            }
            .dark-text-secondary {
                color: #9ca3af !important;
            }
            .dark-text-muted {
                color: #6b7280 !important;
            }
            .dark-border {
                border-color: #30333A !important;
            }
            .dark-info-box {
                background-color: #1f2937 !important;
                border: 1px solid #374151 !important;
            }
        }

        @media only screen and (max-width: 600px) {
            .email-container {
                width: 100% !important;
                margin: 0 !important;
            }
            .mobile-padding {
                padding: 24px !important;
            }
            .mobile-header-padding {
                padding: 24px 24px 12px 24px !important;
            }
            .mobile-text {
                font-size: 14px !important;
                line-height: 1.5 !important;
            }
            .mobile-title {
                font-size: 24px !important;
                line-height: 1.3 !important;
            }
            .mobile-button {
                width: 100% !important;
                text-align: center !important;
            }
            .mobile-button a {
                width: calc(100% - 32px) !important;
                display: block !important;
                text-align: center !important;
            }
            .mobile-outer-padding {
                padding: 20px 10px !important;
            }
            .mobile-price {
                font-size: 28px !important;
            }
        }
        @media only screen and (max-width: 480px) {
            .mobile-title {
                font-size: 22px !important;
            }
            .mobile-padding {
                padding: 15px !important;
            }
            .mobile-header-padding {
                padding: 15px 15px 8px 15px !important;
            }
            .mobile-price {
                font-size: 24px !important;
            }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: #050505; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #050505;">
        <tr>
            <td align="center" class="mobile-outer-padding" style="padding: 40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-container" style="max-width: 600px; background-color: #141414; border-radius: 8px; border: 1px solid #30333A;">

                    <!-- Header with Logo -->
                    <tr>
                        <td align="left" class="mobile-header-padding" style="padding: 40px 40px 20px 40px;">
                            <img src="https://i.ibb.co/r28VWPjS/Screenshot-2025-10-04-123317-Picsart-Ai-Image-Enhancer-removebg-preview.png" alt="Openstock Logo" width="150" style="max-width: 100%; height: auto;">
                        </td>
                    </tr>

                    <!-- Alert Header -->
                    <tr>
                        <td class="mobile-padding" style="padding: 0 40px 20px 40px;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #059669; border-radius: 8px; padding: 20px;">
                                <tr>
                                    <td align="center">
                                        <h1 class="mobile-title" style="margin: 0 0 10px 0; font-size: 24px; font-weight: 700; color: #ffffff; line-height: 1.2;">
                                            📈 价格突破上限
                                        </h1>
                                        <p style="margin: 0; font-size: 16px; color: #ffffff; opacity: 0.9;">
                                            {{timestamp}}
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Main Content -->
                    <tr>
                        <td class="mobile-padding" style="padding: 0 40px 40px 40px;">

                            <!-- Stock Info -->
                            <div class="dark-bg" style="text-align: center; padding: 30px 20px; background-color: #212328; border-radius: 8px; margin-bottom: 10px;">
                                <h2 class="dark-text" style="margin: 0 0 10px 0; font-size: 28px; font-weight: 700; color: #ffffff;">
                                    {{symbol}}
                                </h2>
                                <p class="dark-text-muted" style="margin: 0 0 20px 0; font-size: 16px; color: #6b7280;">
                                    {{company}}
                                </p>

                                <!-- Current Price -->
                                <div style="margin-bottom: 20px;">
                                    <p class="dark-text-muted" style="margin: 0 0 5px 0; font-size: 14px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">
                                        当前价格
                                    </p>
                                    <p class="mobile-price" style="margin: 0; font-size: 36px; font-weight: 700; color: #10b981;">
                                        {{currentPrice}}
                                    </p>
                                </div>
                            </div>

                            <!-- Alert Details -->
                            <div class="dark-info-box" style="background-color: #212328; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                                <h3 class="dark-text" style="margin: 0 0 15px 0; font-size: 18px; font-weight: 600; color: #ffffff;">
                                    提醒详情
                                </h3>
                                <p class="mobile-text dark-text-secondary" style="margin: 0 0 10px 0; font-size: 16px; line-height: 1.5; color: #9ca3af;">
                                    <strong>目标价：</strong>{{targetPrice}}
                                </p>
                                <p class="mobile-text dark-text-secondary" style="margin: 0 0 10px 0; font-size: 16px; line-height: 1.5; color: #9ca3af;">
                                    <strong>触发条件：</strong>价格突破了你设置的上限 {{targetPrice}}
                                </p>
                            </div>

                            <!-- Success Message -->
                            <div style="background-color: #050505; border: 1px solid #374151; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                                <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 600; color: #E8BA40;">
                                    机会来了！
                                </h3>
                                <p class="mobile-text" style="margin: 0; font-size: 14px; line-height: 1.5; color: #ccdadc;">
                                    {{symbol}} 已达到你设置的目标价！现在或许是复盘持仓、考虑止盈或调整策略的好时机。
                                </p>
                            </div>

                            <!-- Action Button -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 30px;">
                                <tr>
                                    <td align="center">
                                        <a href="https://openstock-ods.vercel.app/" style="display: block; width: 100%; max-width: 100%; box-sizing: border-box; color: #000000; background-color: #E8BA40; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-size: 16px; font-weight: 500; line-height: 1; text-align: center;">
                                            查看仪表盘
                                        </a>
                                    </td>
                                </tr>
                            </table>

                             <!-- Footer Text -->
                            <div style="text-align: center; margin: 40px 0 0 0;">
                                <p style="margin: 0 0 10px 0; font-size: 14px; line-height: 1.5; color: #CCDADC !important;">
                                    你收到这封邮件，是因为你订阅了 OpenStock 的资讯更新。
                                </p>
                                <p style="margin: 0 0 10px 0; font-size: 14px; line-height: 1.5; color: #CCDADC !important;">
                                    <a href="#" style="color: #CCDADC !important; text-decoration: underline;">退订</a> |
                                    <a href="https://openstock-ods.vercel.app/" style="color: #CCDADC !important; text-decoration: underline;">访问 OpenStock</a>
                                </p>
                                <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #CCDADC !important;">
                                    © 2025 Open Dev Society
                            </div>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

export const STOCK_ALERT_LOWER_EMAIL_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="format-detection" content="telephone=no">
    <meta name="x-apple-disable-message-reformatting">
    <title>价格提醒：{{symbol}} 触及下限目标价</title>
    <!--[if mso]>
    <noscript>
        <xml>
            <o:OfficeDocumentSettings>
                <o:AllowPNG/>
                <o:PixelsPerInch>96</o:PixelsPerInch>
            </o:OfficeDocumentSettings>
        </xml>
    </noscript>
    <![endif]-->
    <style type="text/css">
        /* Dark mode styles */
        @media (prefers-color-scheme: dark) {
            .email-container {
                background-color: #141414 !important;
                border: 1px solid #30333A !important;
            }
            .dark-bg {
                background-color: #050505 !important;
            }
            .dark-text {
                color: #ffffff !important;
            }
            .dark-text-secondary {
                color: #9ca3af !important;
            }
            .dark-text-muted {
                color: #6b7280 !important;
            }
            .dark-border {
                border-color: #30333A !important;
            }
            .dark-info-box {
                background-color: #1f2937 !important;
                border: 1px solid #374151 !important;
            }
        }

        @media only screen and (max-width: 600px) {
            .email-container {
                width: 100% !important;
                margin: 0 !important;
            }
            .mobile-padding {
                padding: 24px !important;
            }
            .mobile-header-padding {
                padding: 24px 24px 12px 24px !important;
            }
            .mobile-text {
                font-size: 14px !important;
                line-height: 1.5 !important;
            }
            .mobile-title {
                font-size: 24px !important;
                line-height: 1.3 !important;
            }
            .mobile-button {
                width: 100% !important;
                text-align: center !important;
            }
            .mobile-button a {
                width: calc(100% - 32px) !important;
                display: block !important;
                text-align: center !important;
            }
            .mobile-outer-padding {
                padding: 20px 10px !important;
            }
            .mobile-price {
                font-size: 28px !important;
            }
        }
        @media only screen and (max-width: 480px) {
            .mobile-title {
                font-size: 22px !important;
            }
            .mobile-padding {
                padding: 15px !important;
            }
            .mobile-header-padding {
                padding: 15px 15px 8px 15px !important;
            }
            .mobile-price {
                font-size: 24px !important;
            }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: #050505; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #050505;">
        <tr>
            <td align="center" class="mobile-outer-padding" style="padding: 40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-container" style="max-width: 600px; background-color: #141414; border-radius: 8px; border: 1px solid #30333A;">

                    <!-- Header with Logo -->
                    <tr>
                        <td align="left" class="mobile-header-padding" style="padding: 40px 40px 20px 40px;">
                            <img src="https://i.ibb.co/r28VWPjS/Screenshot-2025-10-04-123317-Picsart-Ai-Image-Enhancer-removebg-preview.png" alt="Openstock Logo" width="150" style="max-width: 100%; height: auto;">
                        </td>
                    </tr>

                    <!-- Alert Header -->
                    <tr>
                        <td class="mobile-padding" style="padding: 0 40px 20px 40px;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #dc2626; border-radius: 8px; padding: 20px;">
                                <tr>
                                    <td align="center">
                                        <h1 class="mobile-title" style="margin: 0 0 10px 0; font-size: 24px; font-weight: 700; color: #ffffff; line-height: 1.2;">
                                            📉 价格跌破下限
                                        </h1>
                                        <p style="margin: 0; font-size: 16px; color: #ffffff; opacity: 0.9;">
                                            {{timestamp}}
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Main Content -->
                    <tr>
                        <td class="mobile-padding" style="padding: 0 40px 40px 40px;">

                            <!-- Stock Info -->
                            <div class="dark-bg" style="text-align: center; padding: 30px 20px; background-color: #212328; border-radius: 8px; margin-bottom: 10px;">
                                <h2 class="dark-text" style="margin: 0 0 10px 0; font-size: 28px; font-weight: 700; color: #ffffff;">
                                    {{symbol}}
                                </h2>
                                <p class="dark-text-muted" style="margin: 0 0 20px 0; font-size: 16px; color: #6b7280;">
                                    {{company}}
                                </p>

                                <!-- Current Price -->
                                <div style="margin-bottom: 20px;">
                                    <p class="dark-text-muted" style="margin: 0 0 5px 0; font-size: 14px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">
                                        当前价格
                                    </p>
                                    <p class="mobile-price" style="margin: 0; font-size: 36px; font-weight: 700; color: #ef4444;">
                                        {{currentPrice}}
                                    </p>
                                </div>
                            </div>

                            <!-- Alert Details -->
                            <div class="dark-info-box" style="background-color: #212328; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                                <h3 class="dark-text" style="margin: 0 0 15px 0; font-size: 18px; font-weight: 600; color: #ffffff;">
                                    提醒详情
                                </h3>
                                <p class="mobile-text dark-text-secondary" style="margin: 0 0 10px 0; font-size: 16px; line-height: 1.5; color: #9ca3af;">
                                    <strong>目标价：</strong>{{targetPrice}}
                                </p>
                                <p class="mobile-text dark-text-secondary" style="margin: 0 0 10px 0; font-size: 16px; line-height: 1.5; color: #9ca3af;">
                                    <strong>触发条件：</strong>价格跌破了你设置的下限 {{targetPrice}}
                                </p>
                            </div>

                            <!-- Opportunity Message -->
                            <div style="background-color: #050505; border: 1px solid #374151; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                                <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 600; color: #E8BA40;">
                                    价格已回落
                                </h3>
                                <p class="mobile-text" style="margin: 0; font-size: 14px; line-height: 1.5; color: #ccdadc;">
                                    {{symbol}} 已跌破你设置的目标价。这或许是一个不错的买入时机。
                                </p>
                            </div>

                            <!-- Action Button -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 30px;">
                                <tr>
                                    <td align="center">
                                        <a href="https://openstock-ods.vercel.app/" style="display: block; width: 100%; max-width: 100%; box-sizing: border-box; background-color: #E8BA40; color: #000000; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-size: 16px; font-weight: 500; line-height: 1; text-align: center;">
                                            查看仪表盘
                                        </a>
                                    </td>
                                </tr>
                            </table>

                             <!-- Footer Text -->
                            <div style="text-align: center; margin: 40px 0 0 0;">
                                <p style="margin: 0 0 10px 0; font-size: 14px; line-height: 1.5; color: #CCDADC !important;">
                                    你收到这封邮件，是因为你订阅了 OpenStock 的资讯更新。
                                </p>
                                <p style="margin: 0 0 10px 0; font-size: 14px; line-height: 1.5; color: #CCDADC !important;">
                                    <a href="#" style="color: #CCDADC !important; text-decoration: underline;">退订</a> |
                                    <a href="https://openstock-ods.vercel.app/" style="color: #CCDADC !important; text-decoration: underline;">访问 OpenStock</a>
                                </p>
                                <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #CCDADC !important;">
                                    © 2025 Open Dev Society
                                </p>
                            </div>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

export const VOLUME_ALERT_EMAIL_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="format-detection" content="telephone=no">
    <meta name="x-apple-disable-message-reformatting">
    <title>成交量提醒：{{symbol}}</title>
    <!--[if mso]>
    <noscript>
        <xml>
            <o:OfficeDocumentSettings>
                <o:AllowPNG/>
                <o:PixelsPerInch>96</o:PixelsPerInch>
            </o:OfficeDocumentSettings>
        </xml>
    </noscript>
    <![endif]-->
    <style type="text/css">
        /* Dark mode styles */
        @media (prefers-color-scheme: dark) {
            .email-container {
                background-color: #141414 !important;
                border: 1px solid #30333A !important;
            }
            .dark-bg {
                background-color: #050505 !important;
            }
            .dark-text {
                color: #ffffff !important;
            }
            .dark-text-secondary {
                color: #9ca3af !important;
            }
            .dark-text-muted {
                color: #6b7280 !important;
            }
            .dark-border {
                border-color: #30333A !important;
            }
            .dark-info-box {
                background-color: #1f2937 !important;
                border: 1px solid #374151 !important;
            }
        }

        @media only screen and (max-width: 600px) {
            .email-container {
                width: 100% !important;
                margin: 0 !important;
            }
            .mobile-padding {
                padding: 24px !important;
            }
            .mobile-header-padding {
                padding: 24px 24px 12px 24px !important;
            }
            .mobile-text {
                font-size: 14px !important;
                line-height: 1.5 !important;
            }
            .mobile-title {
                font-size: 24px !important;
                line-height: 1.3 !important;
            }
            .mobile-outer-padding {
                padding: 20px 10px !important;
            }
            .mobile-volume {
                font-size: 28px !important;
            }
        }
        @media only screen and (max-width: 480px) {
            .mobile-title {
                font-size: 22px !important;
            }
            .mobile-padding {
                padding: 15px !important;
            }
            .mobile-header-padding {
                padding: 15px 15px 8px 15px !important;
            }
            .mobile-volume {
                font-size: 24px !important;
            }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: #050505; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #050505;">
        <tr>
            <td align="center" class="mobile-outer-padding" style="padding: 40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-container" style="max-width: 600px; background-color: #141414; border-radius: 8px; border: 1px solid #30333A;">

                    <!-- Header with Logo -->
                    <tr>
                        <td align="left" class="mobile-header-padding" style="padding: 40px 40px 20px 40px;">
                            <img src="https://i.ibb.co/r28VWPjS/Screenshot-2025-10-04-123317-Picsart-Ai-Image-Enhancer-removebg-preview.png" alt="Openstock Logo" width="150" style="max-width: 100%; height: auto;">
                        </td>
                    </tr>

                    <!-- Alert Header -->
                    <tr>
                        <td class="mobile-padding" style="padding: 0 40px 20px 40px;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #7c3aed; border-radius: 8px; padding: 20px;">
                                <tr>
                                    <td align="center">
                                        <h1 class="mobile-title" style="margin: 0 0 10px 0; font-size: 24px; font-weight: 700; color: #ffffff; line-height: 1.2;">
                                            📊 成交量提醒
                                        </h1>
                                        <p style="margin: 0; font-size: 16px; color: #ffffff; opacity: 0.9;">
                                            {{timestamp}}
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Main Content -->
                    <tr>
                        <td class="mobile-padding" style="padding: 0 40px 40px 40px;">

                            <!-- Stock Info -->
                            <div class="dark-bg" style="text-align: center; padding: 30px 20px; background-color: #050505; border-radius: 8px; margin-bottom: 30px;">
                                <h2 class="dark-text" style="margin: 0 0 10px 0; font-size: 28px; font-weight: 700; color: #ffffff;">
                                    {{symbol}}
                                </h2>
                                <p class="dark-text-muted" style="margin: 0 0 20px 0; font-size: 16px; color: #6b7280;">
                                    {{company}}
                                </p>

                                <!-- Current Volume -->
                                <div style="margin-bottom: 20px;">
                                    <p class="dark-text-muted" style="margin: 0 0 5px 0; font-size: 14px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">
                                        当前成交量
                                    </p>
                                    <p class="mobile-volume" style="margin: 0; font-size: 36px; font-weight: 700; color: #7c3aed;">
                                        {{currentVolume}}M
                                    </p>
                                </div>

                                <!-- Current Price (smaller) -->
                                <div class="dark-border" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #30333A;">
                                    <p class="dark-text-secondary" style="margin: 0 0 5px 0; font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px;">
                                        当前价格
                                    </p>
                                    <p style="margin: 0; font-size: 18px; font-weight: 600; color: {{priceColor}};">
                                        {{currentPrice}} ({{changeDirection}}{{changePercent}}%)
                                    </p>
                                </div>
                            </div>

                            <!-- Alert Details -->
                            <div class="dark-info-box" style="background-color: #1f2937; border: 1px solid #374151; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                                <h3 class="dark-text" style="margin: 0 0 15px 0; font-size: 18px; font-weight: 600; color: #ffffff;">
                                    成交量激增详情
                                </h3>
                                <p class="mobile-text dark-text-secondary" style="margin: 0 0 10px 0; font-size: 16px; line-height: 1.5; color: #9ca3af;">
                                    <strong>触发条件：</strong>{{alertMessage}}
                                </p>
                                <p class="mobile-text dark-text-secondary" style="margin: 0 0 10px 0; font-size: 16px; line-height: 1.5; color: #9ca3af;">
                                    <strong>平均成交量：</strong>{{averageVolume}}M 股
                                </p>
                                <p class="mobile-text dark-text-secondary" style="margin: 0; font-size: 16px; line-height: 1.5; color: #9ca3af;">
                                    <strong>检测到激增：</strong>较日常交易活跃度高出 {{volumeSpike}}
                                </p>
                            </div>

                            <!-- What This Means -->
                            <div class="dark-info-box" style="background-color: #1f2937; border: 1px solid #374151; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                                <h3 class="dark-text" style="margin: 0 0 15px 0; font-size: 18px; font-weight: 600; color: #ffffff;">
                                    💡 这意味着什么
                                </h3>
                                <p class="mobile-text dark-text-secondary" style="margin: 0; font-size: 16px; line-height: 1.5; color: #9ca3af;">
                                    成交量放大通常意味着投资者关注度上升、可能有新闻事件，或价格即将出现明显波动。这或许是深入研究背后原因的好机会。
                                </p>
                            </div>

                            <!-- Action Button -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 30px;">
                                <tr>
                                    <td align="center">
                                        <a href="https://openstock-ods.vercel.app" style="display: inline-block; background-color: #E8BA40; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 16px; font-weight: 500; line-height: 1;">
                                            查看仪表盘
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <!-- Disclaimer -->
                            <div class="dark-info-box" style="background-color: #1f2937; border-radius: 6px; padding: 15px; margin-bottom: 20px; border: 1px solid #374151;">
                                <p class="dark-text-muted" style="margin: 0; font-size: 13px; line-height: 1.4; color: #6b7280; text-align: center;">
                                    <strong>免责声明：</strong>本提醒仅供参考，不构成投资建议。成交量放大并不能预示价格走向。在做出任何投资决策前，请务必自行研究判断。
                                </p>
                            </div>

                             <!-- Footer Text -->
                            <div style="text-align: center; margin: 40px 0 0 0;">
                                <p style="margin: 0 0 10px 0; font-size: 14px; line-height: 1.5; color: #CCDADC !important;">
                                    你收到这封邮件，是因为你订阅了 OpenStock 的资讯更新。
                                </p>
                                <p style="margin: 0 0 10px 0; font-size: 14px; line-height: 1.5; color: #CCDADC !important;">
                                    <a href="#" style="color: #CCDADC !important; text-decoration: underline;">退订</a> |
                                    <a href="https://openstock-ods.vercel.app" style="color: #CCDADC !important; text-decoration: underline;">访问 OpenStock</a>
                                </p>
                                <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #CCDADC !important;">
                                    © 2025 Open Dev Society
                                </p>
                            </div>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

export const INACTIVE_USER_REMINDER_EMAIL_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="format-detection" content="telephone=no">
    <meta name="x-apple-disable-message-reformatting">
    <title>我们想你了！市场洞察在等着你</title>
    <!--[if mso]>
    <noscript>
        <xml>
            <o:OfficeDocumentSettings>
                <o:AllowPNG/>
                <o:PixelsPerInch>96</o:PixelsPerInch>
            </o:OfficeDocumentSettings>
        </xml>
    </noscript>
    <![endif]-->
    <style type="text/css">
        /* Dark mode styles */
        @media (prefers-color-scheme: dark) {
            .email-container {
                background-color: #141414 !important;
                border: 1px solid #30333A !important;
            }
            .dark-bg {
                background-color: #050505 !important;
            }
            .dark-text {
                color: #ffffff !important;
            }
            .dark-text-secondary {
                color: #9ca3af !important;
            }
            .dark-text-muted {
                color: #6b7280 !important;
            }
            .dark-border {
                border-color: #30333A !important;
            }
            .dark-info-box {
                background-color: #1f2937 !important;
                border: 1px solid #374151 !important;
            }
        }

        @media only screen and (max-width: 600px) {
            .email-container {
                width: 100% !important;
                margin: 0 !important;
            }
            .mobile-padding {
                padding: 24px !important;
            }
            .mobile-header-padding {
                padding: 24px 24px 12px 24px !important;
            }
            .mobile-text {
                font-size: 14px !important;
                line-height: 1.5 !important;
            }
            .mobile-title {
                font-size: 24px !important;
                line-height: 1.3 !important;
            }
            .mobile-button {
                width: 100% !important;
                text-align: center !important;
            }
            .mobile-button a {
                width: calc(100% - 32px) !important;
                display: block !important;
                text-align: center !important;
            }
            .mobile-outer-padding {
                padding: 20px 10px !important;
            }
        }
        @media only screen and (max-width: 480px) {
            .mobile-title {
                font-size: 22px !important;
            }
            .mobile-padding {
                padding: 15px !important;
            }
            .mobile-header-padding {
                padding: 15px 15px 8px 15px !important;
            }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: #050505; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #050505;">
        <tr>
            <td align="center" class="mobile-outer-padding" style="padding: 40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-container" style="max-width: 600px; background-color: #141414; border-radius: 8px; border: 1px solid #30333A;">

                    <!-- Header with Logo -->
                    <tr>
                        <td align="left" class="mobile-header-padding" style="padding: 40px 40px 20px 40px;">
                            <img src="https://i.ibb.co/r28VWPjS/Screenshot-2025-10-04-123317-Picsart-Ai-Image-Enhancer-removebg-preview.png" alt="Openstock Logo" width="150" style="max-width: 100%; height: auto;">
                        </td>
                    </tr>

                    <!-- Main Content -->
                    <tr>
                        <td class="mobile-padding" style="padding: 40px 40px 40px 40px;">

                            <!-- Welcome Back Heading -->
                            <h1 class="mobile-title dark-text" style="margin: 0 0 15px 0; font-size: 28px; font-weight: 600; background: linear-gradient(135deg, #FDD458 0%, #E8BA40 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; color: #FDD458; line-height: 1.2;">
                                {{name}}，我们想你了！
                            </h1>

                            <!-- Main Message -->
                            <p class="mobile-text dark-text-secondary" style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #CCDADC;">
                                我们注意到你有一段时间没来 OpenStock 了。近期市场波动不断，也许正有一些你不想错过的机会！
                            </p>

                            <!-- Additional Motivation -->
                            <div class="dark-info-box" style="background-color: #050505; border: 1px solid #374151; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                                <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 600; color: #E8BA40;">
                                    市场动态
                                </h3>
                                <p class="mobile-text" style="margin: 0; font-size: 14px; line-height: 1.5; color: #ccdadc;">
                                    最近市场相当活跃！主要指数出现了明显波动，你关注的股票中也许正藏着不容错过的机会。
                                </p>
                            </div>

                            <!-- Encouragement Message -->
                            <p class="mobile-text dark-text-secondary" style="margin: 0 0 40px 0; font-size: 16px; line-height: 1.6; color: #CCDADC;">
                                你的自选股依然有效，随时帮你掌握投资动向。别让市场机会从身边溜走！
                            </p>

                            <!-- CTA Button -->
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 0 20px 0; width: 100%;">
                                <tr>
                                    <td align="center" class="mobile-button">
                                        <a href="https://openstock-ods.vercel.app" style="display: inline-block; background: #E8BA40; color: #000000; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-size: 16px; font-weight: 500; line-height: 1; text-align: center;  width: 100%;">
                                            返回仪表盘
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <!-- Footer Text -->
                            <div style="text-align: center; margin: 40px 0 0 0;">
                                <p style="margin: 0 0 10px 0; font-size: 14px; line-height: 1.5; color: #CCDADC !important;">
                                    有任何疑问？直接回复本邮件，或联系我们的支持团队。
                                </p>
                                <p style="margin: 0 0 10px 0; font-size: 14px; line-height: 1.5; color: #CCDADC !important;">
                                    <a href="#" style="color: #CCDADC !important; text-decoration: underline;">退订</a> |
                                    <a href="https://openstock-ods.vercel.app" style="color: #CCDADC !important; text-decoration: underline;">访问 OpenStock</a>
                                </p>
                                <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #CCDADC !important;">
                                    © 2025 Openstock
                                </p>
                            </div>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
