"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../../../components/ui/Card";

export default function EfficiencyPageRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/#clubes-eficiencia");
  }, [router]);

  return (
    <main className="container grid user-page">
      <Card className="grid">
        <p>Redirecionando para clubes na home...</p>
      </Card>
    </main>
  );
}
