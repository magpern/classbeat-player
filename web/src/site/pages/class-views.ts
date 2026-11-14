// The views of the class pages (docs/design/site.md, "Classes"): the list at `/classes` and one
// class at `/classes/{id}`. The signed-in page loader (signed-in.ts) reads and shows through them.
import { classIdOfPage } from "../core/routes.ts";
import type { SignedInPage } from "../core/routes.ts";
import { readAllClasses, readClass } from "../net/classes.ts";
import { classNotFound, showClass } from "./class-detail.ts";
import { showClasses } from "./classes.ts";
import type { SignedInEnv } from "./signed-in.ts";
import type { View } from "./view.ts";

/** The view of a class page, or undefined for a page that has none yet. */
export function viewOf(page: SignedInPage, env: SignedInEnv): View | undefined {
  if (page.load === "classes") {
    return { loading: "Loading your classes…", read: readAllClasses, show: showClasses, refused: () => false };
  }
  const id = classIdOfPage(page.load);
  if (id === null) return undefined;
  return {
    loading: "Loading the class…",
    read: () => readClass(id),
    show: (main, body) => showClass(main, page.load, body, env),
    // A class that is not there, whatever the reason, is one page (the route gives one answer for all).
    refused: (main, answer) => {
      if (answer.status !== 404) return false;
      classNotFound(main);
      return true;
    },
  };
}
