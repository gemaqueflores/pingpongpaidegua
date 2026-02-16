"use client";

import UserEfficiencyCareerPage from "../../user/eficiencia/[clubId]/page";
import { UserShell } from "../../../components/user/UserShell";

export default function EficienciaClubeCanonicalPage() {
  return (
    <UserShell>
      <UserEfficiencyCareerPage />
    </UserShell>
  );
}

