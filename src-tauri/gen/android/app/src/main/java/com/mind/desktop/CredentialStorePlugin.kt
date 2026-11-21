package com.mind.desktop

import android.app.Activity
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class SaveVaultArgs {
  lateinit var value: String
}

/**
 * Keeps the Mind credential vault encrypted with an AES-256-GCM key that lives
 * in the Android Keystore. Only the IV and ciphertext are written to
 * app-private SharedPreferences, so a device backup, adb pull or rooted file
 * dump does not expose API Keys or the GitHub token.
 *
 * The Rust side mirrors this vault into process memory for synchronous reads
 * and rewrites it after every add/remove.
 */
@TauriPlugin
class CredentialStorePlugin(private val activity: Activity) : Plugin(activity) {
  companion object {
    private const val PREFS_NAME = "mind_credentials"
    private const val PREF_ENTRY = "vault"
    private const val KEY_ALIAS = "mind_credentials_vault"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val TAG_BITS = 128
  }

  private fun prefs() = activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun secretKey(): SecretKey {
    val store = keyStore()
    (store.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return generator.generateKey()
  }

  private fun encrypt(plain: String): String {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    val ciphertext = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
    val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
    val body = Base64.encodeToString(ciphertext, Base64.NO_WRAP)
    return "$iv:$body"
  }

  private fun decrypt(payload: String): String {
    val parts = payload.split(":", limit = 2)
    require(parts.size == 2) { "invalid credential payload" }
    val iv = Base64.decode(parts[0], Base64.NO_WRAP)
    val body = Base64.decode(parts[1], Base64.NO_WRAP)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, iv))
    return String(cipher.doFinal(body), Charsets.UTF_8)
  }

  @Command
  fun saveVault(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SaveVaultArgs::class.java)
      prefs().edit().putString(PREF_ENTRY, encrypt(args.value)).apply()
      val result = JSObject()
      result.put("ok", true)
      invoke.resolve(result)
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "failed to save credentials")
    }
  }

  @Command
  fun loadVault(invoke: Invoke) {
    try {
      val result = JSObject()
      val stored = prefs().getString(PREF_ENTRY, null)
      if (stored == null) {
        result.put("value", null)
      } else {
        result.put("value", decrypt(stored))
      }
      invoke.resolve(result)
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "failed to load credentials")
    }
  }

  @Command
  fun clearVault(invoke: Invoke) {
    try {
      prefs().edit().remove(PREF_ENTRY).apply()
      val result = JSObject()
      result.put("ok", true)
      invoke.resolve(result)
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "failed to clear credentials")
    }
  }
}
