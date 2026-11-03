"use client";

// Нижняя панель разделов на телефоне.
//
// Раньше на узком экране разделы открывались гамбургером: полноэкранный лист,
// и каждый переход стоил двух нажатий. Теперь четыре главных места — в одно
// касание, остальное — под «Ещё». Слайм в середине открывает тьютора, как в
// рейле на компьютере.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LayoutGrid } from "lucide-react";

import { MobileDashboardMenu } from "@/components/mobile-dashboard-menu";
import { SlimeGlyph } from "@/components/nav/slime-glyph";
import {
  getDashboardNavigation,
  getDashboardSections,
  matchNavigation,
  type DashboardSectionKey,
} from "@/config/dashboard-navigation";
import { isRailFreeRoute } from "@/config/rail-free-routes";
import { useAskRail } from "@/contexts/ask-rail";
import { useDashboardPath } from "@/lib/use-dashboard-path";

import styles from "./mobile-tab-bar.module.css";

/** Разделы, у которых есть своя кнопка. Остальные — под «Ещё». */
const TAB_SECTIONS: DashboardSectionKey[] = ["now", "study", "progress"];

export function MobileTabBar() {
  const pathname = useDashboardPath();
  const router = useRouter();
  const askRail = useAskRail();
  const [menuOpen, setMenuOpen] = useState(false);

  if (pathname === "/dashboard/whiteboard") return null;

  const sections = getDashboardSections();
  const byKey = new Map(sections.map((section) => [section.key, section]));
  const { section: active, itemUrl } = matchNavigation(pathname);
  const moreActive = active !== null && !TAB_SECTIONS.includes(active);
  const askOnPage = !isRailFreeRoute(pathname);

  const tab = (key: DashboardSectionKey) => {
    const section = byKey.get(key);
    if (!section) return null;
    const Icon = section.icon;
    const current = active === key;
    return (
      <Link
        key={key}
        href={section.url}
        className={styles.tab}
        data-active={current}
        // «page» — только на самой странице раздела; на «Плане недели» вкладка
        // «Учёба» подсвечена, но ведёт она в дневник.
        aria-current={current ? (itemUrl === section.url ? "page" : "true") : undefined}
      >
        <span className={styles.ico} aria-hidden="true">
          <Icon strokeWidth={1.8} />
        </span>
        {section.title}
      </Link>
    );
  };

  return (
    <nav className={styles.bar} aria-label="Разделы Timely">
      {tab("now")}
      {tab("study")}
      <button
        type="button"
        className={`${styles.tab} ${styles.ask}`}
        aria-label="Спросить тьютора"
        aria-expanded={askOnPage ? askRail.open : undefined}
        onClick={() => {
          if (!askOnPage) router.push("/dashboard/chat");
          else if (askRail.open) askRail.toggle();
          else askRail.openRail();
        }}
      >
        <SlimeGlyph className={styles.slime} />
        Спросить
      </button>
      {tab("progress")}
      <MobileDashboardMenu
        navigationGroups={getDashboardNavigation()}
        onOpenChange={setMenuOpen}
        renderTrigger={(open) => (
          <button
            type="button"
            className={styles.tab}
            data-active={moreActive}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={open}
          >
            <span className={styles.ico} aria-hidden="true">
              <LayoutGrid strokeWidth={1.8} />
            </span>
            Ещё
          </button>
        )}
      />
    </nav>
  );
}
