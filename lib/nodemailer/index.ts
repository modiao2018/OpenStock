import nodemailer from 'nodemailer';
import { WELCOME_EMAIL_TEMPLATE, NEWS_SUMMARY_EMAIL_TEMPLATE } from "@/lib/nodemailer/templates";

type EmailSendResult =
    | { status: 'skipped' }
    | { status: 'sent'; messageId: string };

const hasEmailConfig = Boolean(process.env.NODEMAILER_EMAIL && process.env.NODEMAILER_PASSWORD);

if (!hasEmailConfig) {
    console.warn('⚠️ Email credentials are not configured. Welcome and news summary emails are disabled until NODEMAILER_EMAIL and NODEMAILER_PASSWORD are set.');
}

export const transporter = hasEmailConfig
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.NODEMAILER_EMAIL!,
            pass: process.env.NODEMAILER_PASSWORD!,
        },
        // Keep the pool small because email volume is low in this app.
        pool: true,
        maxConnections: 1,
        maxMessages: 3,
    })
    : null;

if (transporter) {
    transporter.verify((error) => {
        if (error) {
            console.error('❌ Nodemailer transporter verification failed:', error);
        } else {
            console.log('✅ Nodemailer transporter is ready to send emails');
        }
    });
}

export const sendWelcomeEmail = async ({ email, name, intro }: WelcomeEmailData) => {
    try {
        if (!transporter) {
            console.warn('⚠️ Welcome email skipped: email credentials are not configured.');
            return { status: 'skipped' } satisfies EmailSendResult;
        }

        const htmlTemplate = WELCOME_EMAIL_TEMPLATE
            .replace('{{name}}', name)
            .replace('{{intro}}', intro);

        const mailOptions = {
            from: `"HappyStock 团队" <${process.env.NODEMAILER_EMAIL}>`,
            to: email,
            subject: `欢迎加入 HappyStock —— 你的开源股票市场工具箱！`,
            text: '感谢加入 HappyStock（由 Open Dev Society 发起的开源项目）',
            html: htmlTemplate,
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Welcome email sent successfully:', info.messageId);
        return { status: 'sent', messageId: info.messageId } satisfies EmailSendResult;
    } catch (error) {
        console.error('❌ Failed to send welcome email:', error);
        throw error;
    }
}

export const sendNewsSummaryEmail = async (
    { email, date, newsContent }: { email: string; date: string; newsContent: string }
) => {
    try {
        if (!transporter) {
            console.warn('⚠️ News summary email skipped: email credentials are not configured.');
            return { status: 'skipped' } satisfies EmailSendResult;
        }

        const htmlTemplate = NEWS_SUMMARY_EMAIL_TEMPLATE
            .replace('{{date}}', date)
            .replace('{{newsContent}}', newsContent);

        const mailOptions = {
            from: `"HappyStock 团队" <${process.env.NODEMAILER_EMAIL}>`,
            to: email,
            subject: `📈 今日市场新闻摘要 - ${date}`,
            text: `来自 HappyStock 的今日市场新闻摘要`,
            html: htmlTemplate,
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ News summary email sent successfully:', info.messageId);
        return { status: 'sent', messageId: info.messageId } satisfies EmailSendResult;
    } catch (error) {
        console.error('❌ Failed to send news summary email:', error);
        throw error;
    }
};
