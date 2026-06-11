"""
Standalone test + benchmark for check_extended_folders_for_metadata.

Usage:
    cd Services/BedReadDriveSync
    python test_metadata_speed.py

The service must already be configured (folder_id, credentials, main BE token).
This script calls the service directly without HTTP overhead.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv

# Load .env
env_path = project_root / ".env"
if env_path.exists():
    load_dotenv(env_path)
    print(f"[setup] Loaded .env from {env_path}")
else:
    print(f"[setup] No .env found at {env_path}, using environment vars")

# ---------------------------------------------------------------------------
# Phase timing helper
# ---------------------------------------------------------------------------

class PhaseTimer:
    def __init__(self, name: str):
        self.name = name
        self.start = None
        self.elapsed = None

    def __enter__(self):
        self.start = time.perf_counter()
        print(f"\n{'='*60}")
        print(f"[PHASE] {self.name} ...")
        return self

    def __exit__(self, *args):
        self.elapsed = time.perf_counter() - self.start
        print(f"[PHASE] {self.name} done in {self.elapsed:.2f}s")

    def result(self, msg: str = ""):
        print(f"  -> {msg} ({self.elapsed:.2f}s)")


# ---------------------------------------------------------------------------
# Main test
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("Metadata Update Speed Test")
    print("=" * 60)

    # ---- Init service ----
    with PhaseTimer("Init service (load config + build Drive client)") as t:
        from api.services.drive_service import get_drive_sync_service
        from api.services.drive_service._config_store import ConfigStoreMixin

        svc = get_drive_sync_service()
        config = svc.get_config()

        if config is None:
            print("[ERROR] Drive sync config is not set. Run the config setup first.")
            print("        Set FOLDER_ID, GOOGLE_SERVICE_ACCOUNT_JSON, MAIN_BE_API_BASE_URL,")
            print("        MAIN_BE_API_TOKEN, MAIN_BE_USER_ID env vars and configure via API.")
            sys.exit(1)

        print(f"  folder_id: {config.folder_id}")
        print(f"  main_be:   {config.main_be_api_base_url}")
        print(f"  sa_json:   {config.service_account_json_path}")

    # ---- Phase 1: List folders ----
    with PhaseTimer("Phase 1: list_drive_folders (limit=10000)") as t:
        from api.services.drive_service._cover_update import _is_cover_update_folder
        drive_folders_raw, total = svc.list_drive_folders(limit=10000, offset=0)
        target_folders = [f for f in drive_folders_raw if _is_cover_update_folder(f)]
        t.result(f"total={total}, target={len(target_folders)}")

    # ---- Phase 2: Get all server stories ----
    with PhaseTimer("Phase 2: get_all_server_stories") as t:
        all_server_stories = svc.get_all_server_stories()
        t.result(f"fetched {len(all_server_stories)} stories")

    # ---- Phase 3: Match folders to stories ----
    with PhaseTimer("Phase 3: Match folders to server stories") as t:
        server_by_title = {}
        for s in all_server_stories:
            title = s.get("title", "").strip().lower()
            if title:
                server_by_title[title] = s

        folder_story_map = {}
        unmatched = []
        for folder in target_folders:
            title_lower = folder.get("display_name", "").strip().lower()
            if title_lower in server_by_title:
                folder_story_map[folder["id"]] = server_by_title[title_lower]
            else:
                unmatched.append(folder)

        matched_ids = list(folder_story_map.keys())
        t.result(
            f"matched={len(folder_story_map)}, unmatched={len(unmatched)}, "
            f"total_target={len(target_folders)}"
        )

    # ---- Phase 4: Batch fetch matched server stories (parallel) ----
    with PhaseTimer("Phase 4: Batch fetch matched server stories") as t:
        from api.services.drive_service._metadata_update import _batch_fetch_server_stories

        story_ids = [folder_story_map[fid]["id"] for fid in matched_ids]
        stories_full = _batch_fetch_server_stories(svc, story_ids)
        fetched_count = sum(1 for v in stories_full.values() if v is not None)
        t.result(f"fetched {fetched_count}/{len(story_ids)} stories")

    # ---- Phase 5: Batch list metadata files ----
    with PhaseTimer("Phase 5: Batch list metadata files (Drive API)") as t:
        from api.services.drive_service._metadata_update import _batch_list_metadata_files
        from api.services.drive_service._drive_api import DriveAPIMixin

        drive_svc = svc._build_drive_service()

        def retry_fn(fn):
            return DriveAPIMixin._retry_drive_call(svc, fn)

        all_folder_ids = [f["id"] for f in target_folders]
        file_map = _batch_list_metadata_files(drive_svc, all_folder_ids, retry_fn)

        total_files = sum(len(files) for files in file_map.values())
        files_per_type: dict[str, int] = {}
        for files in file_map.values():
            for fname in files:
                files_per_type[fname] = files_per_type.get(fname, 0) + 1

        t.result(f"found {total_files} files across all folders")
        for fname, count in sorted(files_per_type.items()):
            print(f"    {fname}: {count} folder(s)")

    # ---- Phase 6: Batch download + parse ----
    with PhaseTimer("Phase 6: Batch download + parse file content") as t:
        from api.services.drive_service._metadata_update import _batch_download_and_parse

        parsed = _batch_download_and_parse(svc, file_map)
        non_error_count = 0
        for folder_data in parsed.values():
            for val in folder_data.values():
                if not isinstance(val, Exception):
                    non_error_count += 1
        t.result(f"parsed {non_error_count}/{total_files} files successfully")

    # ---- Phase 7: Full check_extended_folders_for_metadata (warm cache) ----
    print()
    print("=" * 60)
    print("Running FULL check_extended_folders_for_metadata (warm cache)...")
    print("=" * 60)

    overall_start = time.perf_counter()
    try:
        result = svc.check_extended_folders_for_metadata()
        overall_elapsed = time.perf_counter() - overall_start
        print(f"\nTotal time: {overall_elapsed:.2f}s")
        print(f"  can_update:     {len(result.get('can_update', []))}")
        print(f"  all_match:      {len(result.get('all_match', []))}")
        print(f"  no_server_match: {len(result.get('no_server_match', []))}")

        # Show first few entries with differences
        can_update = result.get("can_update", [])
        if can_update:
            print(f"\nFirst 3 'can_update' entries:")
            for entry in can_update[:3]:
                diff_fields = [d.get("field") for d in entry.get("differences", [])]
                print(f"  - {entry.get('story_title', '?')}: {diff_fields}")

    except Exception as exc:
        elapsed = time.perf_counter() - overall_start
        print(f"\nERROR after {elapsed:.2f}s: {exc}")
        import traceback
        traceback.print_exc()

    # ---- Save result to file ----
    output_path = project_root / "metadata_check_result.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nFull result saved to: {output_path}")


if __name__ == "__main__":
    main()
