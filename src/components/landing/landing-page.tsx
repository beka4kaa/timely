import { Fragment, type CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Atom,
  BookOpen,
  CalendarDays,
  CodeXml,
  Dna,
  Dumbbell,
  Earth,
  FlaskConical,
  Landmark,
  Languages,
  Leaf,
  MessageCircle,
  NotebookPen,
  PenLine,
  Scale,
  Sigma,
  Target,
  Telescope,
  Timer,
  TrendingUp,
  Triangle,
  type LucideIcon,
} from "lucide-react";
import { appLink } from "@/components/landing/app-url";
import { ChatDemo } from "@/components/landing/chat-demo";
import { LANDING_COPY, type LandingLocale, type SubjectKey } from "@/components/landing/copy";
import { Faq } from "@/components/landing/faq";
import { HeroPrompt } from "@/components/landing/hero-prompt";
import { HtmlLang } from "@/components/landing/html-lang";
import { LangSwitch } from "@/components/landing/lang-switch";
import { LogoMark } from "@/components/landing/logo-mark";
import { Reveal } from "@/components/landing/reveal";
import { ScrollFx } from "@/components/landing/scroll-fx";
import { Slime } from "@/components/landing/slime";
import { SmoothScroll } from "@/components/landing/smooth-scroll";
import { ThemeSwitch } from "@/components/landing/theme-switch";
import { UseCases } from "@/components/landing/use-cases";
import styles from "@/components/landing/landing.module.css";
import { marketingOriginFromEnv } from "@/lib/host-routing";

// Лендинг Timely. Один на оба языка: русская версия на «/», английская на «/en».
// Слова — в copy.ts, здесь разметка, иконки и цвета.

/** Метаданные версии: свой заголовок, описание и ссылки на версию на другом языке. */
export function landingMetadata(locale: LandingLocale): Metadata {
  const copy = LANDING_COPY[locale];
  const metadata: Metadata = {
    // Ссылки на версии и canonical — от настоящего адреса визитки, а не от запасного
    // в корневом layout: хост задаёт окружение (TIMELY_MARKETING_HOST).
    metadataBase: new URL(marketingOriginFromEnv()),
    // Шаблон «… | TimelyPlan» из корневого layout здесь не нужен: бренд уже в начале.
    title: { absolute: copy.meta.title },
    description: copy.meta.description,
    alternates: {
      canonical: copy.path,
      languages: { ru: "/", en: "/en", "x-default": "/" },
    },
  };
  if (locale === "ru") return metadata;
  // У русской версии превью ссылки берётся из корневого layout; английской нужно своё.
  return {
    ...metadata,
    openGraph: {
      type: "website",
      url: copy.path,
      siteName: "TimelyPlan",
      title: copy.meta.title,
      description: copy.meta.description,
      locale: copy.meta.ogLocale,
      alternateLocale: [LANDING_COPY.ru.meta.ogLocale],
    },
    twitter: {
      card: "summary",
      title: copy.meta.title,
      description: copy.meta.description,
    },
  };
}

type Tint = "lilac" | "pink" | "sky" | "mint";

const TINT: Record<Tint, string> = {
  lilac: styles.tintLilac,
  pink: styles.tintPink,
  sky: styles.tintSky,
  mint: styles.tintMint,
};

const FEATURES: { icon: LucideIcon; tint: Tint }[] = [
  { icon: MessageCircle, tint: "pink" },
  { icon: BookOpen, tint: "lilac" },
  { icon: Leaf, tint: "sky" },
];

type Subject = { key: SubjectKey; tint: Tint; icon?: LucideIcon; glyph?: string };

const SUBJECTS: Subject[][] = [
  [
    { key: "algebra", icon: Sigma, tint: "lilac" },
    { key: "geometry", icon: Triangle, tint: "sky" },
    { key: "physics", icon: Atom, tint: "pink" },
    { key: "chemistry", icon: FlaskConical, tint: "mint" },
    { key: "biology", icon: Dna, tint: "pink" },
    { key: "geography", icon: Earth, tint: "sky" },
    { key: "informatics", icon: CodeXml, tint: "lilac" },
    { key: "astronomy", icon: Telescope, tint: "sky" },
  ],
  [
    { key: "russian", glyph: "Аа", tint: "pink" },
    { key: "literature", icon: BookOpen, tint: "lilac" },
    { key: "english", icon: Languages, tint: "sky" },
    { key: "kazakh", glyph: "Қ", tint: "mint" },
    { key: "history", icon: Landmark, tint: "pink" },
    { key: "law", icon: Scale, tint: "lilac" },
    { key: "economics", icon: TrendingUp, tint: "mint" },
    { key: "science", icon: Leaf, tint: "sky" },
  ],
];

const GRADES = ["5", "4", "5", "5", "4"];

function wordCount(text: string) {
  return text.split(" ").length;
}

function Words({ text, from = 0 }: { text: string; from?: number }) {
  return (
    <>
      {text.split(" ").map((word, index) => (
        <Fragment key={index}>
          <span className={styles.word} style={{ "--i": from + index } as CSSProperties}>
            {word}
          </span>{" "}
        </Fragment>
      ))}
    </>
  );
}

function SubjectRow({
  items,
  labels,
  reverse,
}: {
  items: Subject[];
  labels: Record<SubjectKey, string>;
  reverse?: boolean;
}) {
  // Список повторён дважды: лента едет на половину ширины и незаметно
  // начинается заново. Копия скрыта от скринридеров.
  const list = (copy: boolean) => (
    <ul className={styles.tiles} aria-hidden={copy || undefined}>
      {items.map(({ key, icon: Icon, glyph, tint }) => (
        <li key={key} className={`${styles.tile} ${TINT[tint]}`}>
          <span className={styles.tileIcon}>
            {Icon ? <Icon size={22} strokeWidth={1.8} /> : <span className={styles.glyph}>{glyph}</span>}
          </span>
          <span className={styles.tileLabel}>{labels[key]}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className={reverse ? styles.shiftReverse : styles.shift}>
      <div className={`${styles.track} ${reverse ? styles.trackReverse : ""}`}>
        {list(false)}
        {list(true)}
      </div>
    </div>
  );
}

export function LandingPage({ locale }: { locale: LandingLocale }) {
  const copy = LANDING_COPY[locale];
  const { hero, inside } = copy;
  // Слова заголовка проявляются по очереди; слайм занимает в этой очереди одно место.
  const afterAt = wordCount(hero.before) + 1;
  const line2At = afterAt + wordCount(hero.after);

  return (
    <div className={styles.page} lang={locale}>
      {locale !== "ru" && <HtmlLang lang={locale} />}
      <SmoothScroll />
      <header className={styles.header}>
        <span className={styles.progress} aria-hidden="true" />
        <div className={styles.headerInner}>
          <Link href={copy.path} className={styles.brand}>
            <LogoMark size={30} />
            Timely
          </Link>
          <nav className={styles.nav} aria-label={copy.nav.label}>
            <a href="#chat" className={styles.navLink}>
              {copy.nav.tutor}
            </a>
            <a href="#how" className={styles.navLink}>
              {copy.nav.how}
            </a>
            <a href="#subjects" className={styles.navLink}>
              {copy.nav.subjects}
            </a>
            <a href="#faq" className={styles.navLink}>
              {copy.nav.faq}
            </a>
          </nav>
          <div className={styles.headerActions}>
            <LangSwitch locale={locale} label={copy.lang.label} names={copy.lang} />
            <ThemeSwitch labels={copy.theme} />
            <Link href={appLink("/auth/signin")} className={styles.signIn}>
              {copy.header.signIn}
            </Link>
            <Link href={appLink()} className={styles.darkButton} aria-label={copy.header.open}>
              <span className={styles.openFull}>{copy.header.open}</span>
              <span className={styles.openShort} aria-hidden="true">
                {copy.header.openShort}
              </span>
              <ArrowUpRight size={17} strokeWidth={2.2} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <ScrollFx as="section" mode="exit" className={styles.hero}>
          <div className={styles.clouds} aria-hidden="true">
            <span className={`${styles.cloud} ${styles.cloud1}`} />
            <span className={`${styles.cloud} ${styles.cloud2}`} />
            <span className={`${styles.cloud} ${styles.cloud3}`} />
            <span className={`${styles.cloud} ${styles.cloud4}`} />
          </div>

          <div className={`${styles.container} ${styles.heroInner}`}>
            <h1 className={styles.title}>
              <span className={styles.titleLine}>
                <Words text={hero.before} />
                <span className={styles.inlineSlime}>
                  <Slime drop interactive sleepGlyph={copy.slime.sleepGlyph} />
                </span>{" "}
                <Words text={hero.after} from={afterAt} />
              </span>
              <span className={styles.titleLine}>
                <Words text={hero.line2} from={line2At} />
              </span>
            </h1>

            <p className={`${styles.lead} ${styles.intro}`} style={{ "--d": "700ms" } as CSSProperties}>
              {hero.lead}
            </p>

            <div className={styles.intro} style={{ "--d": "850ms" } as CSSProperties}>
              <HeroPrompt copy={copy.prompt} />
            </div>
          </div>
        </ScrollFx>

        <section className={`${styles.section} ${styles.manifesto}`}>
          <div className={styles.container}>
            <ScrollFx mode="through" className={styles.manifestoText}>
              <p>
                {copy.manifesto.split(" ").map((word, index, all) => (
                  <Fragment key={index}>
                    <span
                      className={styles.mWord}
                      style={{ "--i": index, "--n": all.length } as CSSProperties}
                    >
                      {word}
                    </span>{" "}
                  </Fragment>
                ))}
              </p>
            </ScrollFx>
          </div>
        </section>

        <section id="chat" className={styles.section}>
          <div className={styles.container}>
            <Reveal className={styles.sectionHead}>
              <h2 className={styles.h2}>{copy.chat.title}</h2>
              <p className={styles.sub}>{copy.chat.sub}</p>
            </Reveal>

            <ScrollFx mode="enter" end={0.15} className={styles.tiltStage}>
              <div className={styles.tilt}>
                <ChatDemo copy={copy.chatDemo} />
              </div>
            </ScrollFx>

            <div className={styles.features}>
              {FEATURES.map(({ icon: Icon, tint }, index) => {
                const feature = copy.chat.features[index];
                return (
                  <Reveal key={feature.title} delay={index * 90}>
                    <span className={`${styles.featureIcon} ${TINT[tint]}`}>
                      <Icon size={19} strokeWidth={1.9} />
                    </span>
                    <h3 className={styles.featureTitle}>{feature.title}</h3>
                    <p className={styles.featureText}>{feature.text}</p>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        <section id="how" className={styles.section}>
          <div className={styles.container}>
            <Reveal className={styles.sectionHead}>
              <h2 className={styles.h2}>{copy.how.title}</h2>
              <p className={styles.sub}>{copy.how.sub}</p>
            </Reveal>
            <UseCases copy={copy.useCases} slime={copy.slime} />
          </div>
        </section>

        <section id="subjects" className={`${styles.section} ${styles.band}`}>
          <div className={styles.container}>
            <Reveal className={styles.sectionHead}>
              <p className={styles.eyebrow}>{copy.subjects.eyebrow}</p>
              <h2 className={styles.h2}>{copy.subjects.title}</h2>
              <p className={styles.sub}>{copy.subjects.sub}</p>
            </Reveal>
          </div>

          <ScrollFx mode="through" className={styles.marquee}>
            <SubjectRow items={SUBJECTS[0]} labels={copy.subjects.labels} />
            <SubjectRow items={SUBJECTS[1]} labels={copy.subjects.labels} reverse />
          </ScrollFx>

          <div className={styles.container}>
            <p className={styles.moreWrap}>
              <Link href={appLink("/curriculum")} className={styles.moreLink}>
                {copy.subjects.more}
                <ArrowRight size={16} />
              </Link>
            </p>

            <div className={styles.duo}>
              <Reveal className={styles.duoCard}>
                <span className={`${styles.duoIcon} ${styles.tintLilac}`}>
                  <BookOpen size={22} strokeWidth={1.8} />
                </span>
                <div>
                  <h3 className={styles.duoTitle}>{copy.subjects.course.title}</h3>
                  <p className={styles.duoText}>{copy.subjects.course.text}</p>
                </div>
              </Reveal>
              <Reveal className={styles.duoCard} delay={90}>
                <span className={`${styles.duoIcon} ${styles.tintPink}`}>
                  <PenLine size={22} strokeWidth={1.8} />
                </span>
                <div>
                  <h3 className={styles.duoTitle}>{copy.subjects.tell.title}</h3>
                  <p className={styles.duoText}>{copy.subjects.tell.text}</p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <Reveal className={styles.sectionHead}>
              <p className={styles.eyebrow}>{inside.eyebrow}</p>
              <h2 className={styles.h2}>{inside.title}</h2>
            </Reveal>

            <Reveal className={styles.bentoReveal}>
              <ScrollFx mode="enter" end={0.2} className={styles.bento}>
                <article className={`${styles.bentoCard} ${styles.bentoTinted} ${styles.tintLilac} ${styles.areaA}`}>
                  <p className={styles.bigStat}>{inside.step.stat}</p>
                  <p className={styles.bentoText}>{inside.step.text}</p>
                  <p className={styles.bentoFoot}>
                    <CalendarDays size={16} /> {inside.step.foot}
                  </p>
                </article>

                <article className={`${styles.bentoCard} ${styles.areaB}`}>
                  <p className={styles.bentoQuote}>{inside.diary.quote}</p>
                  <div className={styles.grades} aria-hidden="true">
                    {GRADES.map((grade, index) => (
                      <span key={index} style={{ "--i": index } as CSSProperties}>
                        {grade}
                      </span>
                    ))}
                  </div>
                  <p className={styles.bentoFoot}>
                    <NotebookPen size={16} /> {inside.diary.foot}
                  </p>
                </article>

                <article className={`${styles.bentoCard} ${styles.areaC}`}>
                  <p className={styles.bentoQuote}>{inside.weak.quote}</p>
                  <ul className={styles.weak} aria-hidden="true">
                    {inside.weak.topics.map(([topic, value], index) => (
                      <li key={topic}>
                        <span>{topic}</span>
                        <span className={styles.meter}>
                          <span style={{ "--v": `${value}%`, "--i": index } as CSSProperties} />
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className={styles.bentoFoot}>
                    <Target size={16} /> {inside.weak.foot}
                  </p>
                </article>

                <article className={`${styles.bentoCard} ${styles.bentoDark} ${styles.areaD}`}>
                  <ul className={styles.darkModes} aria-hidden="true">
                    {inside.modes.list.map((mode) => (
                      <li key={mode} className={mode === inside.modes.active ? styles.darkModeOn : undefined}>
                        {mode}
                      </li>
                    ))}
                  </ul>
                  <div className={styles.darkCaption}>
                    <p className={styles.darkTitle}>{inside.modes.title}</p>
                    <p className={styles.bentoFoot}>
                      <MessageCircle size={16} /> {inside.modes.foot}
                    </p>
                  </div>
                </article>

                <article className={`${styles.bentoCard} ${styles.bentoTinted} ${styles.tintSky} ${styles.areaE}`}>
                  <div className={styles.ring} aria-hidden="true">
                    <svg viewBox="0 0 120 120">
                      <circle cx="60" cy="60" r="50" className={styles.ringTrack} />
                      <circle cx="60" cy="60" r="50" className={styles.ringValue} pathLength={1} />
                    </svg>
                    <span>{inside.focus.ring}</span>
                  </div>
                  <p className={styles.bentoText}>{inside.focus.text}</p>
                  <p className={styles.bentoFoot}>
                    <Timer size={16} /> {inside.focus.foot}
                  </p>
                </article>

                <article className={`${styles.bentoCard} ${styles.areaF}`}>
                  <p className={styles.bentoQuote}>{inside.practice.quote}</p>
                  <p className={styles.bentoFoot}>
                    <Dumbbell size={16} /> {inside.practice.foot}
                  </p>
                </article>
              </ScrollFx>
            </Reveal>
          </div>
        </section>

        <section id="faq" className={styles.section}>
          <div className={`${styles.container} ${styles.faqGrid}`}>
            <Reveal className={styles.faqAside}>
              <span className={styles.faqGlow} aria-hidden="true" />
              <p className={styles.eyebrow}>{copy.faq.eyebrow}</p>
              <h2 className={styles.h2}>{copy.faq.title}</h2>
              <p className={styles.faqSub}>{copy.faq.sub}</p>
            </Reveal>
            <Reveal delay={90}>
              <Faq items={copy.faq.items} />
            </Reveal>
          </div>
        </section>

        <section className={styles.ctaSection}>
          <div className={styles.container}>
            <Reveal>
              <ScrollFx mode="enter" end={0.45} className={styles.cta}>
                <div className={styles.ctaText}>
                  <h2 className={styles.ctaTitle}>{copy.cta.title}</h2>
                  <p className={styles.ctaSub}>{copy.cta.sub}</p>
                  <div className={styles.ctaActions}>
                    <Link href={appLink()} className={styles.darkButton}>
                      {copy.cta.open}
                      <ArrowUpRight size={17} strokeWidth={2.2} aria-hidden="true" />
                    </Link>
                    <Link href={appLink("/auth/register")} className={styles.lightButton}>
                      {copy.cta.register}
                    </Link>
                  </div>
                </div>
                <div className={styles.ctaSlime}>
                  <div className={styles.ctaLift}>
                    <Slime interactive label={copy.slime.ctaLabel} sleepGlyph={copy.slime.sleepGlyph} />
                  </div>
                </div>
              </ScrollFx>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerGrid}`}>
          <div>
            <Link href={copy.path} className={styles.footerBrand}>
              <LogoMark size={34} />
              Timely
            </Link>
            <p className={styles.footerNote}>{copy.footer.note}</p>
          </div>
          {copy.footer.columns.map((column) => (
            <div key={column.title}>
              <p className={styles.footerTitle}>{column.title}</p>
              <ul className={styles.footerLinks}>
                {column.links.map(([label, path]) => (
                  <li key={label}>
                    <Link href={appLink(path)}>{label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className={`${styles.container} ${styles.footerBottom}`}>
          <span>© {new Date().getFullYear()} Timely</span>
        </div>
      </footer>
    </div>
  );
}
