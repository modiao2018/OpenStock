import { transporter } from "@/lib/nodemailer";

const escapeHtml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

export const sendPasswordResetEmail = async (
    { email, name, resetUrl }: { email: string; name?: string | null; resetUrl: string }
) => {
    try {
        if (!process.env.NODEMAILER_EMAIL || !process.env.NODEMAILER_PASSWORD) {
            throw new Error('Email credentials not configured');
        }

        const firstName = name?.trim().split(' ')[0] || '用户';
        const escapedFirstName = escapeHtml(firstName);
        const escapedResetUrl = escapeHtml(encodeURI(resetUrl));
        const html = `
            <div style="background:#000;padding:32px;font-family:Arial,sans-serif;color:#fff;">
                <div style="max-width:560px;margin:0 auto;border:1px solid #333;border-radius:12px;padding:32px;background:#111;">
                    <h1 style="margin:0 0 16px;font-size:28px;">重置密码</h1>
                    <p style="margin:0 0 16px;color:#d4d4d8;">${escapedFirstName}，你好：</p>
                    <p style="margin:0 0 24px;color:#d4d4d8;line-height:1.6;">
                        我们收到了重置你 OpenStock 账户密码的请求。请点击下方按钮设置新密码。
                    </p>
                    <a
                        href="${escapedResetUrl}"
                        style="display:inline-block;background:#facc15;color:#111827;padding:12px 20px;border-radius:9999px;text-decoration:none;font-weight:700;"
                    >
                        重置密码
                    </a>
                    <p style="margin:24px 0 0;color:#a1a1aa;line-height:1.6;">
                        如果这不是你本人发起的请求，请忽略本邮件即可。
                    </p>
                </div>
            </div>
        `;

        const info = await transporter.sendMail({
            from: `"OpenStock 团队" <${process.env.NODEMAILER_EMAIL}>`,
            to: email,
            subject: '重置你的 OpenStock 密码',
            text: `重置密码链接：${encodeURI(resetUrl)}`,
            html,
        });

        console.log('Password reset email sent successfully:', info.messageId);
        return info;
    } catch (error) {
        console.error('Failed to send password reset email:', error);
        throw error;
    }
};
