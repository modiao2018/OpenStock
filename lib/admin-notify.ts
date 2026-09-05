// Tells reviewers that a sign-up is waiting. Bark push first (the phone is
// where the reviewer actually is); the admin email is a fallback that only
// fires when SMTP is configured. Never throws: a notification outage must
// not turn into a failed sign-up.
import { sendBark } from '@/catalyst-monitor/src/notify';
import { parseAdminEmails } from '@/lib/admin';
import { notifyAdminsOfPendingSignUp } from '@/lib/nodemailer/admin-notify';

export type PendingSignUp = { name: string; email: string; reviewUrl: string };

export const buildPendingSignUpPush = ({ name, email, reviewUrl }: PendingSignUp) => ({
    title: `HappyStock 新注册待审核：${name || email}`,
    body: `${name ? `${name} <${email}>` : email} 刚刚注册，等待你审核。\n点开即可进入审核页。`,
    urgent: false,
    url: reviewUrl,
});

export async function notifyReviewersOfPendingSignUp(
    signUp: PendingSignUp,
): Promise<{ bark: 'sent' | 'failed' | 'skipped'; email: 'sent' | 'skipped' }> {
    const barkUrl = process.env.BARK_URL;
    let bark: 'sent' | 'failed' | 'skipped' = 'skipped';
    if (barkUrl) {
        try {
            await sendBark(barkUrl, buildPendingSignUpPush(signUp));
            bark = 'sent';
        } catch (error) {
            console.error('❌ Bark push for pending sign-up failed:', error);
            bark = 'failed';
        }
    }

    const email = await notifyAdminsOfPendingSignUp({
        adminEmails: parseAdminEmails(process.env.ADMIN_EMAILS),
        ...signUp,
    });

    if (bark !== 'sent' && email !== 'sent') {
        console.warn(`⚠️ Pending sign-up ${signUp.email} has no reviewer notification (bark=${bark}, email=${email}); set BARK_URL or NODEMAILER_*`);
    }
    return { bark, email };
}
