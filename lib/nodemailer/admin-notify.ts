import { transporter } from '@/lib/nodemailer';

const escapeHtml = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Best-effort heads-up to reviewers that someone is waiting. Never throws:
// a mail outage must not turn into a failed sign-up.
export const notifyAdminsOfPendingSignUp = async (
    { adminEmails, name, email, reviewUrl }: { adminEmails: string[]; name: string; email: string; reviewUrl: string },
): Promise<'sent' | 'skipped'> => {
    if (!transporter || adminEmails.length === 0) return 'skipped';
    try {
        await transporter.sendMail({
            from: `"HappyStock" <${process.env.NODEMAILER_EMAIL}>`,
            to: adminEmails.join(', '),
            subject: `新注册待审核：${email}`,
            text: `${name} <${email}> 刚刚注册了 HappyStock，等待审核。\n审核页面：${reviewUrl}`,
            html: `
            <div style="background:#000;padding:32px;font-family:Arial,sans-serif;color:#fff;">
                <div style="max-width:560px;margin:0 auto;border:1px solid #333;border-radius:12px;padding:32px;background:#111;">
                    <h1 style="margin:0 0 16px;font-size:24px;">新注册待审核</h1>
                    <p style="margin:0 0 8px;color:#d4d4d8;">姓名：${escapeHtml(name)}</p>
                    <p style="margin:0 0 24px;color:#d4d4d8;">邮箱：${escapeHtml(email)}</p>
                    <a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#0FEDBE;color:#111827;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:700;">去审核</a>
                </div>
            </div>`,
        });
        return 'sent';
    } catch (error) {
        console.error('❌ Failed to notify admins of pending sign-up:', error);
        return 'skipped';
    }
};
