# mdv — Markdown Viewer
#
# Quick start:
#   make           # checks prerequisites, then debug-builds via SwiftPM into ./build/mdv.app
#   make run       # build + launch
#   make install   # copy to /Applications/, register, and symlink CLI to /usr/local/bin/mdv
#   make help      # full target list
#
# Build is driven by `swift build` + ./build.sh — no Xcode IDE required.

CONFIG       := debug
APP          := build/mdv.app
CLI_SRC      := bin/mdv
CLI_DST      := /usr/local/bin/mdv
ICON_SRC     := MDV.png
ICON_DST     := mdv/AppIcon.icns
LSREGISTER   := /System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister
MIN_MACOS    := 13
MIN_SWIFT    := 5.9

# ---------------------------------------------------------------------------
# Release variables
# ---------------------------------------------------------------------------
# `dist` enforces an exact tag (`vX.Y.Z`) — no shipping `0.1.0` from a commit
# that's just *near* the v0.1.0 tag. Override `VERSION=...` on the command
# line to test individual release targets without tagging first.
APP_NAME      := mdv
# `--match 'v[0-9]*'` filters out rolling tags like the CI's `latest` —
# only proper `vX.Y.Z` tags become valid release versions.
VERSION       ?= $(shell git describe --tags --exact-match --match 'v[0-9]*' 2>/dev/null | sed 's/^v//')
DIST_DIR      := dist
NOTARY_ZIP    := $(DIST_DIR)/$(APP_NAME)-$(VERSION)-notary.zip
RELEASE_ZIP   := $(DIST_DIR)/$(APP_NAME)-$(VERSION)-macos.zip

# Signing identity. Defaults to the project's known Developer ID; override
# CERT_NAME / TEAM_ID on the command line if you ever rotate or run this
# under a different developer account. `codesign -s` substring-matches the
# CN, so passing just the team ID also works on a keychain that has only
# one Developer ID Application cert.
TEAM_ID       ?= KK7E9G89GW
CERT_NAME     ?= Developer ID Application: Thomas Ptacek ($(TEAM_ID))

# Notarization credentials — required for `make notarize`. Either set
# APPLE_ID + NOTARY_PASS (an app-specific password generated at
# appleid.apple.com) on the command line, or stash them once via
# `xcrun notarytool store-credentials` and use `notarytool ... --keychain-profile`
# instead (not wired up here — easy to add when the team grows past one dev).
APPLE_ID      ?=
NOTARY_PASS   ?=

# Release notes file passed to `gh release create`. If unset, the
# github-release target falls back to `--generate-notes`, which derives
# notes from PRs since the previous tag — fine for a project this size,
# replace with --notes-file CHANGELOG.md once we curate one.
NOTES_FILE    ?=

.PHONY: all deps build release run clean install install-cli uninstall register icon help \
        check-version sign zip-notary notarize staple zip-release checksum verify-release \
        dist github-release

all: build

help:
	@echo "Build:"
	@echo "  make / build      Build $(CONFIG) into ./$(APP)  (default)"
	@echo "  release           Build release into ./$(APP)"
	@echo "  run               Build and launch mdv"
	@echo "  clean             Remove ./build/ and ./.build/"
	@echo "  icon              Regenerate $(ICON_DST) from $(ICON_SRC)"
	@echo "  deps              Verify build prerequisites (run automatically before build)"
	@echo ""
	@echo "Local install:"
	@echo "  install           Copy mdv.app to /Applications/, register it, symlink CLI"
	@echo "  install-cli       Symlink $(CLI_SRC) → $(CLI_DST) (sudo)"
	@echo "  uninstall         Remove /Applications/mdv.app and $(CLI_DST)"
	@echo "  register          Refresh LaunchServices for ./$(APP)"
	@echo ""
	@echo "Release pipeline (require an exact 'vX.Y.Z' git tag):"
	@echo "  dist              Build → sign → notarize → staple → zip → checksum"
	@echo "  github-release    Upload \$$(RELEASE_ZIP) + .sha256 to a GitHub release"
	@echo "  sign              codesign with hardened runtime + timestamp"
	@echo "  notarize          Submit notary zip to Apple (needs APPLE_ID/NOTARY_PASS)"
	@echo "  staple            xcrun stapler staple"
	@echo "  verify-release    spctl + codesign sanity-check the bundle"
	@echo ""
	@echo "  help              Show this message"

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------

deps:
	@echo "→ Checking build prerequisites..."
	@OS_VERSION=$$(sw_vers -productVersion 2>/dev/null); \
	if [ -z "$$OS_VERSION" ]; then \
	  echo "  ✗ Could not detect macOS version. mdv only builds on macOS."; exit 1; \
	fi; \
	OS_MAJOR=$$(echo $$OS_VERSION | cut -d. -f1); \
	if [ $$OS_MAJOR -lt $(MIN_MACOS) ]; then \
	  echo "  ✗ macOS $$OS_VERSION — mdv requires macOS $(MIN_MACOS).0 or newer."; exit 1; \
	fi; \
	echo "  ✓ macOS $$OS_VERSION"
	@command -v swift >/dev/null 2>&1 || { \
	  echo "  ✗ swift not on PATH. Install Xcode (App Store) or the Swift toolchain"; \
	  echo "    from https://swift.org/install/macos/, then re-run."; exit 1; }
	@SW_LINE=$$(swift --version 2>&1 | head -1); \
	echo "  ✓ $$SW_LINE"
	@if [ ! -f Package.swift ]; then \
	  echo "  ✗ Package.swift not found in $$(pwd). Run make from the repo root."; \
	  exit 1; \
	fi; \
	echo "  ✓ Package.swift present"
	@if [ ! -x ./build.sh ]; then \
	  echo "  ✗ ./build.sh missing or not executable."; exit 1; \
	fi; \
	echo "  ✓ build.sh present"
	@if command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then \
	  echo "  ✓ sips + iconutil (for 'make icon')"; \
	else \
	  echo "  ⚠ sips or iconutil missing — 'make icon' won't run."; \
	fi
	@echo "→ Prerequisites OK."

# ---------------------------------------------------------------------------
# Build (delegates to ./build.sh, which runs `swift build` + bundles the .app)
# ---------------------------------------------------------------------------

build: deps
	./build.sh $(CONFIG)

release: deps
	./build.sh release

# ---------------------------------------------------------------------------
# Run / install / register
# ---------------------------------------------------------------------------

run: build
	open "$(APP)"

install: build
	@if [ ! -d "$(APP)" ]; then echo "✗ $(APP) missing — build failed?"; exit 1; fi
	rm -rf /Applications/mdv.app
	cp -R "$(APP)" /Applications/
	@echo "✓ copied to /Applications/mdv.app"
	$(LSREGISTER) -f /Applications/mdv.app
	@echo "✓ registered /Applications/mdv.app with LaunchServices"
	@$(MAKE) --no-print-directory install-cli
	@echo "  → To set as default for .md files: right-click any .md → Get Info → Open with → mdv → Change All."

install-cli:
	@if [ ! -x "$(CLI_SRC)" ]; then echo "✗ $(CLI_SRC) missing or not executable"; exit 1; fi
	@SRC_ABS="$$(cd "$$(dirname $(CLI_SRC))" && pwd)/$$(basename $(CLI_SRC))"; \
	$(MAKE) --no-print-directory _sudo CMD="mkdir -p '$$(dirname $(CLI_DST))'" \
	   ASKPASS_PROMPT="Create $$(dirname $(CLI_DST))" >/dev/null; \
	$(MAKE) --no-print-directory _sudo CMD="ln -sf '$$SRC_ABS' '$(CLI_DST)'" \
	   ASKPASS_PROMPT="Symlink mdv CLI into $(CLI_DST)" \
	&& echo "✓ linked $(CLI_DST) → $$SRC_ABS" \
	|| { echo "✗ failed to symlink $(CLI_DST). Run manually:"; \
	     echo "    sudo ln -sf $$SRC_ABS $(CLI_DST)"; exit 1; }

# ---------------------------------------------------------------------------
# Internal helper: run $(CMD) with sudo, falling back to a GUI password
# prompt (osascript) when there's no terminal. Lets `make install` work from
# editors / Claude Code / IDE shells that lack a TTY.
#
# Args:
#   CMD             — shell command to run (required)
#   ASKPASS_PROMPT  — text shown in the GUI dialog (optional)
# ---------------------------------------------------------------------------
_sudo:
	@if [ -z "$(CMD)" ]; then echo "✗ _sudo: CMD is required"; exit 1; fi
	@if eval "$(CMD)" 2>/dev/null; then exit 0; fi; \
	PROMPT="$${ASKPASS_PROMPT:-Run a privileged command for mdv}"; \
	if [ -t 0 ]; then \
	  sudo sh -c "$(CMD)"; \
	else \
	  ASKPASS=$$(mktemp -t mdv-askpass.XXXXXX); \
	  trap 'rm -f "$$ASKPASS"' EXIT; \
	  printf '#!/bin/sh\nosascript -e '\''display dialog "%s" with hidden answer default answer "" with title "mdv install"'\'' -e '\''text returned of result'\'' 2>/dev/null\n' "$$PROMPT" > "$$ASKPASS"; \
	  chmod +x "$$ASKPASS"; \
	  SUDO_ASKPASS="$$ASKPASS" sudo -A sh -c "$(CMD)"; \
	fi

uninstall:
	@if [ -L "$(CLI_DST)" ] || [ -e "$(CLI_DST)" ]; then \
	  rm -f "$(CLI_DST)" 2>/dev/null || sudo rm -f "$(CLI_DST)"; \
	  echo "✓ removed $(CLI_DST)"; \
	else \
	  echo "  (no $(CLI_DST) to remove)"; \
	fi
	@if [ -d /Applications/mdv.app ]; then \
	  rm -rf /Applications/mdv.app 2>/dev/null || sudo rm -rf /Applications/mdv.app; \
	  echo "✓ removed /Applications/mdv.app"; \
	else \
	  echo "  (no /Applications/mdv.app to remove)"; \
	fi

register: build
	$(LSREGISTER) -f "$(APP)"
	@echo "✓ registered $(APP) with LaunchServices"

# ---------------------------------------------------------------------------
# Clean
# ---------------------------------------------------------------------------

clean:
	rm -rf build .build build_icon
	@echo "✓ removed build/, .build/, and build_icon/"

# ---------------------------------------------------------------------------
# Icon (regenerate from MDV.png)
# ---------------------------------------------------------------------------

icon: $(ICON_DST)

$(ICON_DST): $(ICON_SRC)
	@command -v sips     >/dev/null 2>&1 || { echo "✗ sips not found";     exit 1; }
	@command -v iconutil >/dev/null 2>&1 || { echo "✗ iconutil not found"; exit 1; }
	@rm -rf build_icon
	@mkdir -p build_icon/AppIcon.iconset
	@sips -p 1024 1024 --padColor FFFFFF "$(ICON_SRC)" --out build_icon/square.png >/dev/null
	@SQ=build_icon/square.png; SET=build_icon/AppIcon.iconset; \
	 sips -z 16   16   $$SQ --out $$SET/icon_16x16.png      >/dev/null && \
	 sips -z 32   32   $$SQ --out $$SET/icon_16x16@2x.png   >/dev/null && \
	 sips -z 32   32   $$SQ --out $$SET/icon_32x32.png      >/dev/null && \
	 sips -z 64   64   $$SQ --out $$SET/icon_32x32@2x.png   >/dev/null && \
	 sips -z 128  128  $$SQ --out $$SET/icon_128x128.png    >/dev/null && \
	 sips -z 256  256  $$SQ --out $$SET/icon_128x128@2x.png >/dev/null && \
	 sips -z 256  256  $$SQ --out $$SET/icon_256x256.png    >/dev/null && \
	 sips -z 512  512  $$SQ --out $$SET/icon_256x256@2x.png >/dev/null && \
	 sips -z 512  512  $$SQ --out $$SET/icon_512x512.png    >/dev/null && \
	 sips -z 1024 1024 $$SQ --out $$SET/icon_512x512@2x.png >/dev/null
	@iconutil -c icns build_icon/AppIcon.iconset -o "$(ICON_DST)"
	@echo "✓ regenerated $(ICON_DST) from $(ICON_SRC)"

# ---------------------------------------------------------------------------
# Release pipeline: sign → zip-for-notary → notarize → staple → zip-for-release → checksum
#
# The dance with two zips is on purpose. Apple's notary service operates on
# a zip; stapling writes a ticket back into the .app bundle; the *zip we
# distribute* needs to be a fresh zip taken AFTER stapling so the stapled
# ticket is inside it. Otherwise users without internet on first launch
# fail Gatekeeper because the ticket isn't bundled.
#
# Typical invocation once everything's wired:
#
#   make dist \
#     APPLE_ID="you@example.com" \
#     NOTARY_PASS="xxxx-xxxx-xxxx-xxxx"
#
# CERT_NAME / TEAM_ID default to the project's signing identity (see vars
# at top); APPLE_ID + NOTARY_PASS have no defaults because they're secrets.
# ---------------------------------------------------------------------------

dist: check-version clean release sign zip-notary notarize staple zip-release checksum verify-release
	@echo "✓ release artifact ready: $(RELEASE_ZIP)"
	@echo "  next: make github-release   (or upload $(RELEASE_ZIP) manually)"

check-version:
	@if [ -z "$(VERSION)" ]; then \
	  echo "✗ releases must be built from an exact git tag, e.g.  git tag v0.1.0 && make dist"; \
	  echo "  (override with VERSION=... on the command line for one-off testing)"; \
	  exit 1; \
	fi
	@echo "→ release version $(VERSION)"

# `--options runtime` enables hardened runtime, which the notary service
# requires. `--timestamp` embeds a secure timestamp from Apple's TSA so the
# signature stays valid past the cert expiry. `--deep` walks bundled
# frameworks; we don't currently embed any, but the flag is cheap insurance.
sign: release
	@if [ -z "$(CERT_NAME)" ]; then echo "✗ CERT_NAME required"; exit 1; fi
	@# Preflight: the leaf cert needs Apple's "Developer ID Certification
	@# Authority" intermediate available somewhere in the keychain search
	@# path or codesign fails with the famously unhelpful
	@# `errSecInternalComponent`. Download it from
	@# https://www.apple.com/certificateauthority/ and double-click to install.
	@security find-certificate -c "Developer ID Certification Authority" >/dev/null 2>&1 \
	  || security find-certificate -c "Developer ID Certification Authority" /Library/Keychains/System.keychain >/dev/null 2>&1 \
	  || { \
	    echo "✗ Apple's 'Developer ID Certification Authority' intermediate cert is missing from your keychains."; \
	    echo "  Without it, codesign can't build the chain to a trusted root."; \
	    echo "  Fix: download the G2 intermediate from https://www.apple.com/certificateauthority/"; \
	    echo "  and double-click the .cer to install it into your login keychain."; \
	    exit 1; \
	  }
	@echo "→ signing $(APP) as $(CERT_NAME)"
	codesign --force --deep --options runtime --timestamp \
	  --sign "$(CERT_NAME)" "$(APP)"
	codesign --verify --deep --strict --verbose=2 "$(APP)"

zip-notary: sign
	@mkdir -p "$(DIST_DIR)"
	rm -f "$(NOTARY_ZIP)"
	ditto -c -k --keepParent "$(APP)" "$(NOTARY_ZIP)"
	@echo "✓ wrote $(NOTARY_ZIP)"

notarize: zip-notary
	@if [ -z "$(APPLE_ID)" ] || [ -z "$(TEAM_ID)" ] || [ -z "$(NOTARY_PASS)" ]; then \
	  echo "✗ APPLE_ID, TEAM_ID, and NOTARY_PASS required"; \
	  echo "  generate an app-specific password at https://appleid.apple.com → Sign-In and Security → App-Specific Passwords"; \
	  exit 1; \
	fi
	@echo "→ submitting $(NOTARY_ZIP) to notary service (this can take a few minutes)"
	xcrun notarytool submit "$(NOTARY_ZIP)" \
	  --apple-id "$(APPLE_ID)" \
	  --team-id "$(TEAM_ID)" \
	  --password "$(NOTARY_PASS)" \
	  --wait

staple: notarize
	xcrun stapler staple "$(APP)"
	xcrun stapler validate "$(APP)"

zip-release: staple
	rm -f "$(RELEASE_ZIP)"
	ditto -c -k --keepParent "$(APP)" "$(RELEASE_ZIP)"
	@echo "✓ wrote $(RELEASE_ZIP)"

checksum: zip-release
	cd "$(DIST_DIR)" && shasum -a 256 "$$(basename $(RELEASE_ZIP))" > "$$(basename $(RELEASE_ZIP)).sha256"
	@echo "✓ wrote $(RELEASE_ZIP).sha256"

# Final sanity check: spctl confirms the stapled bundle passes Gatekeeper
# without ever phoning Apple.
verify-release: zip-release
	spctl --assess --type execute --verbose "$(APP)"
	codesign --verify --deep --strict --verbose=2 "$(APP)"

# Upload the artifacts to a GitHub release. Doesn't depend on `dist` —
# the artifacts must already exist (so you can re-run this if the upload
# itself fails without rebuilding/notarizing). Pass NOTES_FILE=PATH to use
# curated release notes; otherwise gh auto-generates from PRs.
github-release:
	@if ! command -v gh >/dev/null 2>&1; then echo "✗ gh CLI not installed (brew install gh)"; exit 1; fi
	@if [ -z "$(VERSION)" ]; then echo "✗ VERSION required (tag or override)"; exit 1; fi
	@if [ ! -f "$(RELEASE_ZIP)" ]; then echo "✗ $(RELEASE_ZIP) not found — run make dist first"; exit 1; fi
	@if [ ! -f "$(RELEASE_ZIP).sha256" ]; then echo "✗ $(RELEASE_ZIP).sha256 not found — run make dist first"; exit 1; fi
	gh release create "v$(VERSION)" \
	  "$(RELEASE_ZIP)" \
	  "$(RELEASE_ZIP).sha256" \
	  --title "$(APP_NAME) $(VERSION)" \
	  $(if $(NOTES_FILE),--notes-file "$(NOTES_FILE)",--generate-notes)
	@echo "✓ published v$(VERSION)"
