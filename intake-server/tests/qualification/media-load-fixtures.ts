import sharp from 'sharp'
import type { Pool } from 'pg'

/** Only installed in the disposable workload database. Sample the publication transaction at commit. */
export async function recordPublicationTimes(pool: Pool) {
  await pool.query(`
    CREATE TABLE qualification_publication (command_id uuid PRIMARY KEY, publication_ms double precision NOT NULL);
    CREATE FUNCTION qualification_record_publication() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
    BEGIN
      INSERT INTO public.qualification_publication VALUES (NEW.command_id,extract(epoch FROM (clock_timestamp()-transaction_timestamp()))*1000);
      RETURN NULL;
    END;
    $$;
    CREATE CONSTRAINT TRIGGER qualification_publication_commit AFTER INSERT ON media_decode_result
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qualification_record_publication();
  `)
}

export async function cameraPhotos() {
  const inputs: Buffer[] = []
  for (let i = 0; i < 6; i++) {
    const width = 2400,
      height = 1600
    const pixels = Buffer.alloc(width * height * 3)
    for (let k = 0; k < pixels.length; k += 3) {
      const x = (k / 3) % width
      const y = Math.floor(k / (3 * width))
      pixels[k] = (x + y + i * 30) % 256
      pixels[k + 1] = (y + i * 7) % 256
      pixels[k + 2] = (x / 8 + y / 16 + i) % 256
    }
    inputs.push(
      await sharp(pixels, { raw: { width, height, channels: 3 } })
        .withMetadata({ orientation: i % 2 ? 6 : 1 })
        .jpeg()
        .toBuffer(),
    )
  }
  return inputs
}
