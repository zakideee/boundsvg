import {
  chmod,
  link,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAnimatedRasterFileSink, createAnimatedRasterSpool } from "../src/animation-file.js";

/** Temporary directories owned by these tests until cleanup after each case. */
const directories: string[] = [];
async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "animated-file-test-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("animated raster Node storage", () => {
  it("keeps the old pathname until finish, then preserves snapshotted permission bits", async () => {
    const path = join(await directory(), "output.webp");
    await writeFile(path, "previous");
    await chmod(path, 0o754);
    const sink = await createAnimatedRasterFileSink(path);
    await sink.write(Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]));
    await sink.patch(4, Uint8Array.of(4, 0, 0, 0));
    expect(await readFile(path, "utf8")).toBe("previous");
    await sink.finish();
    expect((await stat(path)).mode & 0o7777).toBe(0o754);
    expect([...(await readFile(path))]).toEqual([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
    await sink.abort("late cleanup");
    expect((await stat(path)).size).toBe(12);
    expect(await readdir(join(path, ".."))).toEqual(["output.webp"]);
  });

  it("replaces the final symlink itself without changing its former target", async () => {
    const root = await directory();
    const original = join(root, "original");
    const path = join(root, "link.gif");
    await writeFile(original, "old target");
    await symlink(original, path);
    const sink = await createAnimatedRasterFileSink(path);
    await sink.write(Uint8Array.of(71, 73, 70));
    await sink.finish();
    expect((await lstat(path)).isSymbolicLink()).toBe(false);
    expect(await readFile(original, "utf8")).toBe("old target");
    expect(await readFile(path, "utf8")).toBe("GIF");
  });

  it("preserves another hardlink's old inode and contents", async () => {
    const root = await directory();
    const path = join(root, "output.gif");
    const other = join(root, "other.gif");
    await writeFile(path, "old inode");
    await link(path, other);
    const originalInode = (await stat(path)).ino;
    const sink = await createAnimatedRasterFileSink(path);
    await sink.write(Uint8Array.of(71, 73, 70));
    await sink.finish();
    expect((await stat(path)).ino).not.toBe(originalInode);
    expect((await stat(other)).ino).toBe(originalInode);
    expect(await readFile(other, "utf8")).toBe("old inode");
  });

  it("aborts only its exclusive temporary file and keeps the destination", async () => {
    const root = await directory();
    const path = join(root, "output.gif");
    await writeFile(path, "previous");
    const sink = await createAnimatedRasterFileSink(path);
    await sink.write(Uint8Array.of(1, 2, 3));
    expect(await readdir(root)).toHaveLength(2);
    await sink.abort("cancel");
    await sink.abort("repeat");
    expect(await readdir(root)).toEqual(["output.gif"]);
    expect(await readFile(path, "utf8")).toBe("previous");
    await expect(sink.finish()).rejects.toMatchObject({ context: { reason: "aborted" } });
  });

  it("retains the destination after rename failure and removes its temp on abort", async () => {
    const root = await directory();
    const occupied = join(root, "occupied");
    await import("node:fs/promises").then((filesystem) => filesystem.mkdir(occupied));
    const sink = await createAnimatedRasterFileSink(occupied);
    await sink.write(Uint8Array.of(1));
    await expect(sink.finish()).rejects.toMatchObject({ code: "ANIMATED_RASTER_SINK_FAILED" });
    expect((await stat(occupied)).isDirectory()).toBe(true);
    await sink.abort("failed commit");
    expect(await readdir(root)).toEqual(["occupied"]);
  });

  it("reads a patched spool in bounded chunks, signals EOF and deletes only its temp", async () => {
    const root = await directory();
    const spool = await createAnimatedRasterSpool(root);
    const bytes = new Uint8Array(65539);
    bytes.fill(42);
    await spool.sink.write(bytes);
    await spool.sink.patch(4, Uint8Array.of(1, 2, 3, 4));
    await expect(spool.read(0, 1)).rejects.toMatchObject({ code: "ANIMATED_RASTER_SINK_FAILED" });
    await spool.sink.finish();
    const first = await spool.read(0, 65536);
    expect(first).toHaveLength(65536);
    expect([...first.subarray(4, 8)]).toEqual([1, 2, 3, 4]);
    expect(await spool.read(65536, 65536)).toEqual(Uint8Array.of(42, 42, 42));
    expect(await spool.read(65539, 1)).toHaveLength(0);
    await expect(spool.read(0, 65537)).rejects.toMatchObject({
      code: "ANIMATED_RASTER_SINK_FAILED",
    });
    await spool.dispose();
    await spool.dispose();
    expect(await readdir(root)).toEqual([]);
  });
});
