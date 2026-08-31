import Link from "next/link";
import Image from "next/image";
import { getTranslations } from "next-intl/server";

const Footer = async () => {
    const t = await getTranslations('footer');

    return (
        <footer className="bg-gray-900 text-white border-t border-gray-800">
            <div className="container mx-auto px-4 py-12">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {/* Brand Section */}
                    <div className="col-span-1 md:col-span-2">
                        <Link href="/" className="flex items-center gap-2 mb-4">
                            <Image
                                src="/assets/images/logo.svg"
                                alt="HappyStock"
                                width={150}
                                height={38}
                                className="brightness-0 invert"
                            />
                        </Link>
                        <p className="text-gray-400 mb-6 max-w-md">
                            {t('tagline')}
                        </p>
                    </div>

                    {/* Resources */}
                    <div>
                        <h3 className="text-lg font-semibold mb-4">{t('resources')}</h3>
                        <ul className="space-y-2">
                            <li>
                                <Link href="/help" className="text-gray-400 hover:text-white transition-colors duration-200 relative group">
                                    <span className="relative">
                                        {t('helpCenter')}
                                        <span className="absolute left-0 bottom-0 w-0 h-0.5 bg-white transition-all duration-300 group-hover:w-full"></span>
                                    </span>
                                </Link>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
