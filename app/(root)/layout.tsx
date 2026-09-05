import Header from "@/components/Header";
import { getSession } from "@/lib/get-session";
import { redirect } from "next/navigation";
import Footer from "@/components/Footer";
import { isAdminEmail } from "@/lib/admin";

const Layout = async ({ children }: { children: React.ReactNode }) => {
    const session = await getSession();

    if (!session?.user) redirect('/sign-in');

    const user = {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
    }

    return (
        <main className="min-h-screen text-gray-400">
            <Header user={user} isAdmin={isAdminEmail(session.user.email)} />

            <div className="container py-10">
                {children}
            </div>

            <Footer />
        </main>
    )
}
export default Layout