"use client";

import UserEfficiencyHomePage from "../user/eficiencia/page";
import { UserShell } from "../../components/user/UserShell";

export default function EficienciaCanonicalPage() {
  return (
    <UserShell>
      <UserEfficiencyHomePage />
    </UserShell>
  );
}

