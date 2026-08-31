import Link from "next/link";
import Image from "next/image";
import NavItems from "@/components/NavItems";
import UserDropdown from "@/components/UserDropdown";

// The popular-stock list loads lazily when the search dialog first opens —
// awaiting 10 Finnhub profile calls here would block the shell on every hard load
const Header = ({ user }: { user: User }) => {
    const initialStocks: StockWithWatchlistStatus[] = [];

    return (
        <header className="sticky top-0 header">
            <div className="container header-wrapper">
                <Link href="/" className="flex items-center justify-center gap-2">
                    <Image
                        src="/assets/images/logo.svg"
                        alt="HappyStock"
                        width={200}
                        height={50}
                    />
                </Link>
                <nav className="hidden sm:block">
                    <NavItems initialStocks={initialStocks}/>
                </nav>

                <UserDropdown user={user} initialStocks={initialStocks} />
            </div>
        </header>
    )
}
export default Header