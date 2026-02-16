"use client";

import UserAthleteSummaryPage from "../../../../user/events/[id]/athletes/[athleteId]/page";
import { UserShell } from "../../../../../components/user/UserShell";

export default function EventAthleteSummaryCanonical() {
  return (
    <UserShell>
      <UserAthleteSummaryPage />
    </UserShell>
  );
}

