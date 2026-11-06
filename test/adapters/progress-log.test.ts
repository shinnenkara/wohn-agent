import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { openDatabase, openReadOnlyDatabase } from "../../src/adapters/sqlite/database.js";
import { SqliteListingRepository } from "../../src/adapters/sqlite/listing-repository.js";
import { SqliteMailStore } from "../../src/adapters/sqlite/mail-store.js";
import { SqliteProgressLog } from "../../src/adapters/sqlite/progress-log.js";
import { gmailUrl } from "../../src/domain/gmail-url.js";
import { discoverListing } from "../fakes.js";

describe("sqlite progress", () => {
  it("backfills each listing once and then records only forward hops", () => {
    const db = openDatabase(":memory:");
    try {
      const listings = new SqliteListingRepository(db);
      const discovered = discoverListing("100000001");
      const applied = discoverListing("100000002").startApplying().markApplied(new Date("2026-11-01T10:00:00.000Z"));
      listings.insertAll([discovered]);
      listings.save(applied);
      const progress = new SqliteProgressLog(db);
      const at = new Date("2026-11-05T10:00:00.000Z");
      assert.equal(progress.backfillListings(at), 2);
      assert.equal(progress.backfillListings(at), 0);
      assert.equal(progress.stageOf(discovered.scoutId), "discovered");
      assert.equal(progress.stageOf(applied.scoutId), "applied");
      assert.equal(progress.listTransitions().length, 1);
      assert.equal(progress.listTransitions()[0]?.toStage, "applied");
      assert.equal(progress.listTransitions()[0]?.source, "backfill");
      assert.equal(
        progress.note({
          scoutId: discovered.scoutId,
          next: "applied",
          source: "apply",
          evidenceId: discovered.scoutId,
          at,
        }),
        true,
      );
      assert.equal(
        progress.note({
          scoutId: discovered.scoutId,
          next: "discovered",
          source: "apply",
          evidenceId: discovered.scoutId,
          at,
        }),
        false,
      );
      assert.equal(progress.stageOf(discovered.scoutId), "applied");
      const mail = new SqliteMailStore(db);
      mail.insertMail(
        {
          gmailId: "m1",
          threadId: "t1",
          from: "landlord@example.com",
          subject: "Neue Nachricht",
          sentAt: "2026-11-02T10:00:00.000Z",
          text: "hello",
          html: "",
          kind: "message_copy",
          scoutId: applied.scoutId,
        },
        at,
      );
      mail.insertEvent(
        {
          id: "e1",
          title: "Viewing",
          description: "",
          start: "2026-11-12T17:00:00.000Z",
          end: "2026-11-12T17:30:00.000Z",
          place: "Badstr. 54",
          scoutId: applied.scoutId,
        },
        at,
      );
      db.prepare(
        "INSERT INTO google_account (id, email, token_json, connected_at) VALUES (1, 'a@example.com', '', ?)",
      ).run(at.toISOString());
      const cards = progress.listApartments("applied");
      assert.equal(cards.length, 2);
      const card = cards.find((item) => item.scoutId === applied.scoutId);
      assert.equal(card?.opened, true);
      assert.equal(card?.mails[0]?.subject, "Neue Nachricht");
      assert.equal(card?.mails[0]?.url, gmailUrl("m1", "a@example.com"));
      const unlinked = new SqliteMailStore(db);
      unlinked.insertMail(
        {
          gmailId: "m2",
          threadId: "t2",
          from: "scout@immobilienscout24.de",
          subject: "Ohne Objekt",
          sentAt: "2026-11-03T10:00:00.000Z",
          text: "hello",
          html: "",
          kind: "unclassified",
          scoutId: "",
        },
        at,
      );
      assert.equal(unlinked.listUnlinkedMail(20)[0]?.url, gmailUrl("m2", "a@example.com"));
      assert.equal(card?.viewings[0]?.place, "Badstr. 54");
    } finally {
      db.close();
    }
  });

  it("lets a read-only connection see rows while the writer is open", () => {
    const dir = mkdtempSync(join(tmpdir(), "wohn-ro-"));
    const path = join(dir, "agent.db");
    const writer = openDatabase(path);
    try {
      writer
        .prepare("INSERT INTO listings (scout_id, url, status) VALUES ('1', 'https://www.immobilienscout24.de/expose/1', 'DISCOVERED')")
        .run();
      const reader = openReadOnlyDatabase(path);
      try {
        const row = reader.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number };
        assert.equal(Number(row.n), 1);
        assert.throws(() => reader.exec("DELETE FROM listings"));
      } finally {
        reader.close();
      }
    } finally {
      writer.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
