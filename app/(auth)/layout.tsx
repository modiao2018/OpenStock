import Link from "next/link";
import React from "react";
import Image from "next/image";
import {redirect} from "next/navigation";
import {getTranslations} from "next-intl/server";
import {getSession} from "@/lib/get-session";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import AuthContact from "@/components/AuthContact";

/*
  Direction contract (impeccable, seed c0609038)
  THESIS: one quiet centered pane on a deep field, the way an Apple ID sheet
    presents itself; refuses the split marketing panel and the collage.
  OWN-WORLD: near-black #050505 ground with a single soft teal aurora low on
    the page; a 28px-radius card of #141414 glass with a 1px white/8 edge and a
    long, soft shadow; SF-like system sans, 30px semibold title with -0.02em
    tracking; 48px pill-free rounded-xl controls; teal #0FEDBE reserved for the
    primary button, focus ring, and the captcha's solved state.
  STORY: "this is the same product I use every night, and it takes me
    seriously" — enter credentials, prove you're human with one slide, in.
  FIRST VIEWPORT: logo mark alone at top; card centered vertically; inside:
    title, subtitle, two fields, captcha, one full-width teal button, then a
    hairline and the sign-up link. Language switcher top-right, contact at
    the page foot.
  FORM: candidate 6 of the grounded list, "Apple account sheet". Seed c0609038.
  FINISH: unreviewed and undocumented is unfinished; this build ends with the
    finish review, the verdict, DESIGN.md, and every shipping raster carrying
    its provenance.
*/
const Layout = async ({ children }: { children : React.ReactNode }) => {

    const session = await getSession();

    if (session?.user) redirect('/')

    const t = await getTranslations('auth.layout');

    return (
        <main className="auth-page">
            <div className="auth-aurora" aria-hidden="true" />

            <header className="auth-header">
                <Link href="/" className="auth-logo" aria-label="HappyStock">
                    <Image src="/assets/images/logo.svg" alt="HappyStock" width={170} height={27} priority />
                </Link>
                <LanguageSwitcher />
            </header>

            <section className="auth-card-wrap">
                <div className="auth-card">
                    {children}
                </div>
            </section>

            <footer className="auth-footer">
                <p className="auth-fineprint">{t('fineprint')}</p>
                <AuthContact />
            </footer>
        </main>
    )
}
export default Layout
