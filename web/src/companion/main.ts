// The handlebar companion page's entry, served at /control. boot.ts is imported first, so the
// fragment is read and removed from the address before any other code of the page runs.
import { fragment } from "./boot.ts";
import "../design/tokens.css";
import "./companion.css";
import { CompanionApp } from "./app.ts";

new CompanionApp(document.body, fragment);
