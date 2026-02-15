import { Hero } from "./Hero";
import type { ReactNode } from "react";

type HeroTitleProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

export function HeroTitle(props: HeroTitleProps) {
  return <Hero {...props} />;
}
