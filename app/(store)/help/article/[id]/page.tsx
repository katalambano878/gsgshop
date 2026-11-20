import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getGoodsBaseUrl } from '@/lib/site-urls';
import { HELP_ARTICLES, HELP_CATEGORIES, STORE_PHONE, STORE_PHONE_TEL, getHelpArticle } from '../../articles';

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ id: a.id }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const article = getHelpArticle(id);
  return article
    ? { title: article.title, description: article.summary, alternates: { canonical: `${getGoodsBaseUrl()}/help/article/${article.id}` } }
    : { title: 'Help', robots: { index: false } };
}

export default async function HelpArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = getHelpArticle(id);
  if (!article) notFound();

  const category = HELP_CATEGORIES.find((c) => c.id === article.category);
  const related = HELP_ARTICLES.filter((a) => a.category === article.category && a.id !== article.id);

  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-gray-600">
          <ol className="flex flex-wrap items-center gap-2">
            <li><Link href="/help" className="text-gsg-purple hover:text-gsg-purple-dark font-semibold">Help Centre</Link></li>
            <li aria-hidden="true">/</li>
            <li>{category?.title}</li>
          </ol>
        </nav>

        <article className="bg-white rounded-xl shadow-sm p-6 sm:p-8 mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gsg-black mb-3">{article.title}</h1>
          <p className="text-lg text-gray-600 mb-8">{article.summary}</p>

          <div className="space-y-6 text-gray-700 leading-relaxed">
            {article.sections.map((section, i) => (
              <section key={i}>
                {section.heading && <h2 className="text-lg font-bold text-gsg-black mb-2">{section.heading}</h2>}
                {section.paragraphs?.map((p, j) => (
                  <p key={j} className="mb-3">{p}</p>
                ))}
                {section.list && (
                  <ul className="list-disc pl-6 space-y-2">
                    {section.list.map((item, j) => <li key={j}>{item}</li>)}
                  </ul>
                )}
              </section>
            ))}
          </div>

          {article.links && article.links.length > 0 && (
            <div className="mt-8 flex flex-wrap gap-3">
              {article.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  {...(link.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className="inline-flex items-center gap-2 bg-gsg-purple hover:bg-gsg-purple-dark text-white px-5 py-3 rounded-lg font-semibold transition-colors"
                >
                  {link.label}
                  <i className="ri-arrow-right-line" aria-hidden="true"></i>
                </Link>
              ))}
            </div>
          )}
        </article>

        {related.length > 0 && (
          <section aria-labelledby="related-help" className="bg-white rounded-xl shadow-sm p-6 sm:p-8 mb-8">
            <h2 id="related-help" className="text-xl font-bold text-gsg-black mb-4">More about {category?.title.toLowerCase()}</h2>
            <ul className="space-y-2">
              {related.map((a) => (
                <li key={a.id}>
                  <Link href={`/help/article/${a.id}`} className="text-gsg-purple hover:text-gsg-purple-dark font-medium">
                    {a.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="bg-purple-50 border border-purple-100 rounded-xl p-6 text-center">
          <p className="font-semibold text-gsg-black mb-2">Did not find your answer?</p>
          <p className="text-gray-700 mb-4">Call or WhatsApp us on <a href={`tel:${STORE_PHONE_TEL}`} className="font-semibold text-gsg-purple underline">{STORE_PHONE}</a>, or send us a message.</p>
          <Link href="/contact" className="inline-block bg-gsg-purple hover:bg-gsg-purple-dark text-white px-6 py-3 rounded-lg font-semibold transition-colors">
            Contact us
          </Link>
        </div>
      </div>
    </main>
  );
}
