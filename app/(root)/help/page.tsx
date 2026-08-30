import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import {
  HelpCircle,
  MessageCircle,
  BookOpen,
  Lightbulb,
  Mail,
  Github,
  ChevronDown
} from 'lucide-react';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata');
  return {
    title: t('help.title'),
    description: t('help.description'),
  };
}

export default async function HelpPage() {
  const t = await getTranslations('help');
  const faqs = t.raw('faq') as { question: string; answer: string }[];

  return (
    <div className="max-w-4xl mx-auto px-4 pb-20">

      {/* Header */}
      <div className="text-center pt-16 pb-12 space-y-4">
        <div className="inline-flex p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20 mb-4">
          <HelpCircle className="text-blue-400 h-8 w-8" />
        </div>
        <h1 className="text-4xl md:text-5xl font-bold text-white">{t('title')}</h1>
        <p className="text-xl text-gray-400">{t('subtitle')}</p>
      </div>

      {/* Quick Action Grid */}
      <div className="grid md:grid-cols-3 gap-4 mb-16">
        <HelpCard
          icon={<BookOpen className="text-teal-400" />}
          title={t('cards.docs.title')}
          desc={t('cards.docs.desc')}
          link="/api-docs"
          linkText={t('cards.docs.linkText')}
        />
        <HelpCard
          icon={<MessageCircle className="text-purple-400" />}
          title={t('cards.chat.title')}
          desc={t('cards.chat.desc')}
          link="https://discord.gg/JkJ8kfxgxB"
          linkText={t('cards.chat.linkText')}
        />
        <HelpCard
          icon={<Github className="text-white" />}
          title={t('cards.bugs.title')}
          desc={t('cards.bugs.desc')}
          link="https://github.com/Open-Dev-Society/HappyStock/issues"
          linkText={t('cards.bugs.linkText')}
        />
      </div>

      {/* FAQs */}
      <div className="space-y-8">
        <h2 className="text-2xl font-bold text-white border-b border-gray-800 pb-4">{t('faqTitle')}</h2>
        <div className="grid gap-4">
          {faqs.map((faq, idx) => (
            <div key={idx} className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 hover:bg-gray-800/50 transition-colors">
              <h3 className="font-semibold text-lg text-gray-200 mb-2 flex items-start gap-3">
                <Lightbulb size={20} className="text-yellow-500/50 mt-1 shrink-0" />
                {faq.question}
              </h3>
              <p className="text-gray-400 leading-relaxed ml-8 pl-1 border-l-2 border-gray-800">
                {faq.answer}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Direct Contact */}
      <div className="mt-20 bg-gradient-to-br from-gray-900 to-black border border-gray-800 rounded-2xl p-8 text-center">
        <h3 className="text-xl font-bold text-white mb-2">{t('stuckTitle')}</h3>
        <p className="text-gray-400 mb-6">{t('stuckDesc')}</p>
        <a
          href="mailto:opendevsociety@gmail.com"
          className="inline-flex items-center gap-2 bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-gray-200 transition-colors"
        >
          <Mail size={18} />
          {t('contactButton')}
        </a>
      </div>

    </div>
  );
}

function HelpCard({ icon, title, desc, link, linkText }: any) {
  return (
    <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl flex flex-col items-start hover:border-gray-700 transition-colors">
      <div className="mb-4 bg-gray-800 p-2 rounded-lg">{icon}</div>
      <h3 className="font-bold text-white text-lg mb-2">{title}</h3>
      <p className="text-sm text-gray-400 mb-6 flex-grow">{desc}</p>
      <a href={link} className="text-teal-400 text-sm font-medium hover:underline flex items-center gap-1">
        {linkText} <ChevronDown size={14} className="-rotate-90" />
      </a>
    </div>
  );
}
