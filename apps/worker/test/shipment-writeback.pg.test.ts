import { sql } from "@garanti-kulucka/database";
import { expect, it } from "vitest";
import { DatabaseShipmentWritebackRepository } from "../src/shipment-writeback.js";
import { describePg, withRollback } from "./support/pg.js";

describePg("shipment write-back against Postgres", () => {
  it("keeps a delivered shipment delivered when a late tracking answer arrives, but lets a return through", async () => {
    await withRollback(async (db) => {
      await sql`insert into shipments (public_id, provider, status, recipient_name, recipient_address) values ('shp_wb_delivered', 'ptt', 'delivered', 'Alıcı', 'Adres')`.execute(db);
      const repository = new DatabaseShipmentWritebackRepository(db);
      await repository.apply({ shipmentPublicId: "shp_wb_delivered", trackingNumber: null, status: "in_transit", lastEventText: "Transfer merkezinde" });
      expect(await db.selectFrom("shipments").select(["status", "last_event_text"]).where("public_id", "=", "shp_wb_delivered").executeTakeFirstOrThrow()).toEqual({ status: "delivered", last_event_text: "Transfer merkezinde" });
      await repository.apply({ shipmentPublicId: "shp_wb_delivered", trackingNumber: null, status: "returned", lastEventText: "Göndericiye iade" });
      expect((await db.selectFrom("shipments").select("status").where("public_id", "=", "shp_wb_delivered").executeTakeFirstOrThrow()).status).toBe("returned");
    });
  });
});
