const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('@expo/config-plugins');

/**
 * Keep rules for the parts of this app that R8 cannot see are in use.
 *
 * R8 removes what nothing references, and it reads references in bytecode. Everything React Native
 * and Expo reach by name at runtime is invisible to it: native modules are resolved from a string,
 * Hermes calls into JNI, and OkHttp's platform detection probes for classes that may not exist. The
 * symptom is never a build failure — the app compiles, installs, launches, and then one screen is
 * blank or one call throws, in release only, while debug stays perfect. That is the whole reason
 * minification is a separate switch on the build script.
 *
 * These rules are deliberately narrow. A blanket `-keep class **` would guarantee correctness and
 * also give up the ~10 MB the exercise is for. Everything here is either a documented consumer rule
 * that the library does not ship itself, or something this app specifically reaches reflectively.
 *
 * A config plugin rather than an edit to android/app/proguard-rules.pro because android/ is
 * generated and untracked: an edit there lasts until the next prebuild and then silently reverts,
 * and the failure it reintroduces only shows up on a device.
 */

const MARKER = '# qingmu keep rules';

const RULES = `
${MARKER} — see plugins/withQingmuProguardRules.js

# Expo resolves modules by their registered name, so nothing in bytecode points at these classes.
-keep class expo.modules.** { *; }
-keep class * extends expo.modules.kotlin.modules.Module { *; }
-keepclassmembers class * { @expo.modules.kotlin.functions.* <methods>; }

# React Native's bridge and TurboModules are reached from JavaScript by name.
-keep class com.facebook.react.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.proguard.annotations.** { *; }
-keepclassmembers class * { @com.facebook.react.bridge.ReactMethod <methods>; }
-keepclassmembers class * { @com.facebook.react.uimanager.annotations.ReactProp <methods>; }
-keepclassmembers class * { @com.facebook.react.uimanager.annotations.ReactPropGroup <methods>; }

# Anything called from native code has no Java-side caller for R8 to find.
-keepclasseswithmembernames class * { native <methods>; }

# OkHttp and Okio probe for optional platform classes; the warnings are expected, not defects.
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# Kotlin coroutines' internal service loading is reflective.
-keepclassmembers class kotlinx.coroutines.** { volatile <fields>; }
-dontwarn kotlinx.coroutines.**

# A stack trace from a release build is unreadable without these, and they cost almost nothing.
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod
`;

module.exports = function withQingmuProguardRules(config) {
  return withDangerousMod(config, ['android', (mod) => {
    const rulesPath = path.join(mod.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
    const existing = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf8') : '';
    if (existing.includes(MARKER)) return mod;
    fs.writeFileSync(rulesPath, `${existing.trimEnd()}\n${RULES}`, 'utf8');
    return mod;
  }]);
};
