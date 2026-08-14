import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
};

const RULES = [
  {
    number: "01",
    title: "Names stay names",
    body: "Character names, sects, and titles like Young Cult Leader or Heavenly Demon are kept exactly as written. Technique names, cultivation realms, and artifact names are never “adapted.”",
  },
  {
    number: "02",
    title: "Prose that breathes",
    body: "Long English sentences break into short, rhythmic Indonesian. The tone holds true — tension stays tense, humor stays light, grandeur stays grand.",
  },
  {
    number: "03",
    title: "Structure that flows",
    body: "Every line of dialogue gets its own paragraph. Chapter titles and translator credits are preserved verbatim. No walls of text, no machine stiffness.",
  },
];

const STEPS = [
  {
    number: "01",
    title: "Upload",
    body: "Drop in a chapter file — .txt or .md — straight from your release queue.",
  },
  {
    number: "02",
    title: "Translate",
    body: "The chapter is split and translated against the standard, segment by segment, with progress as it goes.",
  },
  {
    number: "03",
    title: "Export",
    body: "Copy the finished chapter or download it as clean text, ready for your site.",
  },
];

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/70">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="font-display text-lg tracking-tight">Laras</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              web novel translation studio
            </span>
          </Link>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="rounded-sm border-border/80 bg-transparent text-foreground hover:bg-muted"
          >
            <Link to="/auth?returnTo=/dashboard">Sign in</Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto w-full max-w-5xl px-6 pt-24 pb-20 sm:pt-32">
        <motion.p
          {...fadeUp}
          className="text-[11px] font-medium tracking-[0.28em] text-muted-foreground uppercase"
        >
          For solo web novel translators
        </motion.p>

        <motion.h1
          {...fadeUp}
          transition={{ duration: 0.6, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="font-display mt-6 max-w-2xl text-5xl leading-[1.05] tracking-tight text-balance sm:text-6xl"
        >
          Chapters, translated with intent.
        </motion.h1>

        <motion.p
          {...fadeUp}
          transition={{ duration: 0.6, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg"
        >
          Laras turns uploaded chapters of wuxia, xianxia, murim, and fantasy
          fiction into natural, fluent Indonesian — while every name, title,
          and technique stays exactly as written.
        </motion.p>

        <motion.div
          {...fadeUp}
          transition={{ duration: 0.6, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className="mt-10 flex flex-wrap items-center gap-3"
        >
          <Button
            asChild
            className="rounded-sm px-5 py-2.5 shadow-none hover:bg-foreground/90"
          >
            <Link to="/auth?returnTo=/dashboard">
              Start translating
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            className="rounded-sm px-5 py-2.5 text-foreground hover:bg-muted"
          >
            <a href="#standard">Read the standard</a>
          </Button>
        </motion.div>

        {/* Demonstration sample */}
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.6, delay: 0.34, ease: [0.22, 1, 0.36, 1] }}
          className="mt-20 border-t border-border/70"
        >
          <div className="grid gap-0 sm:grid-cols-2">
            <div className="border-b border-border/70 py-8 pr-8 sm:border-r sm:border-b-0">
              <p className="text-[10px] font-medium tracking-[0.24em] text-muted-foreground uppercase">
                Source
              </p>
              <p className="font-display mt-4 text-lg leading-7">
                “The Heavenly Demon raised his sword and met the Young Cult
                Leader’s gaze.”
              </p>
            </div>
            <div className="py-8 sm:pl-8">
              <p className="text-[10px] font-medium tracking-[0.24em] text-muted-foreground uppercase">
                Translated
              </p>
              <p className="font-display mt-4 text-lg leading-7">
                “Heavenly Demon mengangkat pedangnya dan menatap balik Young
                Cult Leader.”
              </p>
            </div>
          </div>
          <p className="pt-6 text-xs text-muted-foreground">
            Titles, names, and techniques are kept in the original — only the
            prose moves into Indonesian.
          </p>
        </motion.div>
      </section>

      {/* The standard */}
      <section id="standard" className="mx-auto w-full max-w-5xl px-6 py-20">
        <motion.div
          {...fadeUp}
          viewport={{ once: true, margin: "-80px" }}
          whileInView={{ opacity: 1, y: 0 }}
          className="border-t border-border/70 pt-12"
        >
          <p className="text-[11px] font-medium tracking-[0.28em] text-muted-foreground uppercase">
            The standard
          </p>
          <h2 className="font-display mt-4 max-w-xl text-3xl tracking-tight text-balance sm:text-4xl">
            Translation rules that hold the line.
          </h2>
        </motion.div>

        <div className="mt-14 grid gap-x-12 gap-y-12 sm:grid-cols-3">
          {RULES.map((rule, i) => (
            <motion.div
              key={rule.number}
              {...fadeUp}
              viewport={{ once: true, margin: "-60px" }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.5,
                delay: i * 0.08,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="border-t border-border/70 pt-6"
            >
              <span className="text-xs font-medium tracking-[0.2em] text-muted-foreground">
                {rule.number}
              </span>
              <h3 className="font-display mt-3 text-xl tracking-tight">
                {rule.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {rule.body}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto w-full max-w-5xl px-6 py-20">
        <motion.div
          {...fadeUp}
          viewport={{ once: true, margin: "-80px" }}
          whileInView={{ opacity: 1, y: 0 }}
          className="border-t border-border/70 pt-12"
        >
          <p className="text-[11px] font-medium tracking-[0.28em] text-muted-foreground uppercase">
            How it works
          </p>
          <h2 className="font-display mt-4 max-w-xl text-3xl tracking-tight text-balance sm:text-4xl">
            From upload to release, in three steps.
          </h2>
        </motion.div>

        <div className="mt-14 grid gap-0 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.number}
              {...fadeUp}
              viewport={{ once: true, margin: "-60px" }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.5,
                delay: i * 0.08,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="border-t border-border/70 py-6 sm:border-r sm:px-8 sm:first:pl-0 sm:last:border-r-0 sm:last:pr-0"
            >
              <span className="font-display text-2xl text-muted-foreground">
                {step.number}
              </span>
              <h3 className="mt-4 text-sm font-medium tracking-wide">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {step.body}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto w-full max-w-5xl px-6 py-24">
        <motion.div
          {...fadeUp}
          viewport={{ once: true, margin: "-80px" }}
          whileInView={{ opacity: 1, y: 0 }}
          className="border-t border-border/70 pt-16 text-center"
        >
          <h2 className="font-display mx-auto max-w-md text-3xl tracking-tight text-balance sm:text-4xl">
            Ready for the next chapter?
          </h2>
          <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
            Bring your own release queue. Laras handles the prose — you keep
            the names, the tone, and the readers.
          </p>
          <Button
            asChild
            className="mt-8 rounded-sm px-6 py-2.5 shadow-none hover:bg-foreground/90"
          >
            <Link to="/auth?returnTo=/dashboard">
              Open the studio
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/70">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-6 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            <span className="font-display text-sm text-foreground">Laras</span>{" "}
            — translation studio for solo web novel translators
          </span>
          <span>© 2026 Laras</span>
        </div>
      </footer>
    </div>
  );
}
