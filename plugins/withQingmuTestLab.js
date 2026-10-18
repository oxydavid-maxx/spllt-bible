const fs = require('node:fs');
const path = require('node:path');
const { withMainApplication } = require('@expo/config-plugins');

// Android only: Firebase documents this Settings.System key for Test Lab and Play pre-launch reports.
// https://firebase.google.com/docs/test-lab/android/android-studio#modify_instrumented_test_behavior_for
module.exports = function withQingmuTestLab(config) {
  return withMainApplication(config, (mod) => {
    const { contents, language } = mod.modResults;
    const packageName = /^package\s+([\w.]+)/m.exec(contents)?.[1];
    if (language !== 'kt' || !packageName) throw new Error('Test Lab bridge requires a Kotlin MainApplication');
    const registration = 'add(QingmuTestLabPackage())';
    if (!contents.includes(registration)) {
      const anchor = /PackageList\(this\)\.packages\.apply\s*\{/;
      if (!anchor.test(contents)) throw new Error('Test Lab bridge cannot find the React package list');
      mod.modResults.contents = contents.replace(anchor, (match) => `${match}\n          ${registration}`);
    }
    const directory = path.dirname(mod.modResults.path);
    fs.writeFileSync(path.join(directory, 'QingmuTestLabPackage.kt'), `package ${packageName}

import android.provider.Settings
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class QingmuTestLabModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "QingmuTestLab"

  @ReactMethod
  fun isRunningInTestLab(promise: Promise) {
    try {
      val setting = Settings.System.getString(reactApplicationContext.contentResolver, "firebase.test.lab")
      promise.resolve("true" == setting)
    } catch (error: Exception) {
      promise.reject("TEST_LAB_SETTING_UNAVAILABLE", error)
    }
  }
}

class QingmuTestLabPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(QingmuTestLabModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
`, 'utf8');
    return mod;
  });
};
