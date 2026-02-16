"use client";

import UserEventPage from "../../user/events/[id]/page";
import { UserShell } from "../../../components/user/UserShell";

export default function EventPageCanonical() {
  return (
    <UserShell>
      <UserEventPage />
    </UserShell>
  );
}

