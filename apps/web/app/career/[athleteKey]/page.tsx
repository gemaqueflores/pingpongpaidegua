"use client";

import UserCareerPage from "../../user/career/[athleteKey]/page";
import { UserShell } from "../../../components/user/UserShell";

export default function CareerCanonicalPage() {
  return (
    <UserShell>
      <UserCareerPage />
    </UserShell>
  );
}

