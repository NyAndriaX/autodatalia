from __future__ import annotations

from typing import Any


def normalize_locale(value: str | None) -> str:
    return "fr" if str(value or "").lower().startswith("fr") else "en"


_PLATFORMS = {
    "en": {
        "facebook": "Facebook",
        "instagram": "Instagram",
        "tiktok": "TikTok",
        "linkedin": "LinkedIn",
        "none": "none",
    },
    "fr": {
        "facebook": "Facebook",
        "instagram": "Instagram",
        "tiktok": "TikTok",
        "linkedin": "LinkedIn",
        "none": "aucune",
    },
}


_TEXT = {
    "en": {
        "validation_header": "Validation request",
        "schedule_line": "Schedule: {schedule}",
        "no_text": "(no text)",
        "post_id": "Post ID: {post_id}",
        "platforms": "Platforms: {platforms}",
        "approve": "Approve",
        "reject": "Reject",
        "edit_with_ai": "Edit with AI",
        "resend_card": "Resend card",
        "regenerate": "Regenerate",
        "cancel": "Cancel",
        "timeout_title": "Validation timeout",
        "timeout_body": "Auto-generated post for rule '{rule_name}' reached its publish time without a decision.",
        "timeout_prompt": "What should I do?",
        "submitted_for_validation": "Submitted post {post_id} for Telegram validation.",
        "rule_changed_after_generation": "Auto-generated post {post_id} could not be approved because its rule changed after generation.",
        "rule_changed_wait_fresh": "Rule changed. Wait for a fresh validation card.",
        "approved_scheduled_auto": "Auto-generated post {post_id} approved in Telegram - scheduled to fire at its target time.",
        "approved_scheduled_manual": "Post {post_id} approved in Telegram - scheduled to fire at its target time.",
        "approved_scheduled_short": "Approved - scheduled.",
        "approved_publishing": "Post {post_id} approved in Telegram - publishing now.",
        "approved_publishing_short": "Approved - publishing.",
        "rejected_validation": "Post {post_id} rejected in Telegram.",
        "rejected_short": "Rejected.",
        "edit_reply_prompt": "Reply to this message with the changes you want. Datalia will rewrite the post and send it back for approval.",
        "edit_reply_placeholder": "What should change?",
        "send_edits_short": "Send your edits as a reply.",
        "already_status": "Already {status} - no action taken.",
        "validation_card_resent": "Validation card for {post_id} resent after timeout.",
        "card_resent_short": "Card resent.",
        "regen_short": "Regenerating...",
        "regen_failed": "Regeneration failed: {error}",
        "timeout_cancelled": "Auto-generated post {post_id} cancelled at timeout.",
        "cancelled_short": "Cancelled.",
        "revised_and_resubmitted": "Post {post_id} was revised from Telegram feedback and resubmitted.",
        "published_ok": "Post {post_id} published.",
        "links_header": "Links:",
        "missing_link": "link unavailable",
        "partial_failures": "Some targets failed:",
        "publish_not_completed": "Post {post_id} did not publish - status={status}, error={error}",
        "publish_crashed": "Publishing post {post_id} crashed: {error}",
        "scheduler_published": "Scheduled post published to {target} ({platform}).",
        "scheduler_failed": "{target} ({platform}) failed: {error}",
        "scheduler_no_targets": "Scheduled post could not fire - no connected accounts for the selected platforms. Reconnect in Settings.",
        "scheduler_crashed": "Scheduled post crashed: {error}",
        "auto_submitted": "Auto-generated post for rule '{rule_name}' submitted to Telegram for validation.",
        "auto_submit_failed": "Auto-generated post {post_id} created but Telegram submission failed: {error}",
        "auto_missing_chat": "Auto-generated post {post_id} created but no Telegram chat configured - set TELEGRAM_BOT_TOKEN and a chat id on the rule or TELEGRAM_DEFAULT_CHAT_ID.",
        "auto_regenerated": "Auto-generated post {post_id} regenerated after timeout.",
        "auto_timeout_prompt": "Auto-generated post {post_id} hit its publish time without validation - sent timeout prompt to Telegram.",
        "auto_cancelled_rule_changed": "Auto-generated post {post_id} was cancelled because its source rule changed or no longer exists.",
        "auto_rule_skipped": "Rule '{rule_name}' skipped - no Telegram validation destination configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_DEFAULT_CHAT_ID (or validation_chat_id on the rule). Auto-posts cannot fire without approval.",
        "auto_generation_failed": "Automation rule '{rule_name}' failed during generation: {error}",
    },
    "fr": {
        "validation_header": "Demande de validation",
        "schedule_line": "Planification : {schedule}",
        "no_text": "(sans texte)",
        "post_id": "ID du post : {post_id}",
        "platforms": "Plateformes : {platforms}",
        "approve": "Approuver",
        "reject": "Rejeter",
        "edit_with_ai": "Modifier avec l'IA",
        "resend_card": "Renvoyer la carte",
        "regenerate": "Régénérer",
        "cancel": "Annuler",
        "timeout_title": "Validation expirée",
        "timeout_body": "Le post généré automatiquement pour la règle '{rule_name}' a atteint son heure de publication sans décision.",
        "timeout_prompt": "Que dois-je faire ?",
        "submitted_for_validation": "Post {post_id} soumis à validation Telegram.",
        "rule_changed_after_generation": "Le post auto-généré {post_id} n'a pas pu être approuvé car sa règle a changé après la génération.",
        "rule_changed_wait_fresh": "La règle a changé. Attendez une nouvelle carte de validation.",
        "approved_scheduled_auto": "Post auto-généré {post_id} approuvé dans Telegram - planifié à l'heure prévue.",
        "approved_scheduled_manual": "Post {post_id} approuvé dans Telegram - planifié à l'heure prévue.",
        "approved_scheduled_short": "Approuvé - planifié.",
        "approved_publishing": "Post {post_id} approuvé dans Telegram - publication en cours.",
        "approved_publishing_short": "Approuvé - publication en cours.",
        "rejected_validation": "Post {post_id} rejeté dans Telegram.",
        "rejected_short": "Rejeté.",
        "edit_reply_prompt": "Répondez à ce message avec les changements souhaités. Datalia réécrira le post et le renverra pour approbation.",
        "edit_reply_placeholder": "Que faut-il changer ?",
        "send_edits_short": "Envoyez vos modifications en réponse.",
        "already_status": "Déjà {status} - aucune action effectuée.",
        "validation_card_resent": "Carte de validation pour {post_id} renvoyée après expiration.",
        "card_resent_short": "Carte renvoyée.",
        "regen_short": "Régénération...",
        "regen_failed": "Échec de la régénération : {error}",
        "timeout_cancelled": "Post auto-généré {post_id} annulé après expiration.",
        "cancelled_short": "Annulé.",
        "revised_and_resubmitted": "Le post {post_id} a été révisé après retour Telegram et resoumis.",
        "published_ok": "Post {post_id} publié.",
        "links_header": "Liens :",
        "missing_link": "lien indisponible",
        "partial_failures": "Certains comptes ont échoué :",
        "publish_not_completed": "Le post {post_id} n'a pas été publié - statut={status}, erreur={error}",
        "publish_crashed": "La publication du post {post_id} a planté : {error}",
        "scheduler_published": "Post planifié publié sur {target} ({platform}).",
        "scheduler_failed": "{target} ({platform}) a échoué : {error}",
        "scheduler_no_targets": "Le post planifié n'a pas pu partir - aucun compte connecté pour les plateformes sélectionnées. Reconnectez-les dans les paramètres.",
        "scheduler_crashed": "La publication planifiée a planté : {error}",
        "auto_submitted": "Post auto-généré pour la règle '{rule_name}' soumis à validation Telegram.",
        "auto_submit_failed": "Le post auto-généré {post_id} a été créé mais l'envoi Telegram a échoué : {error}",
        "auto_missing_chat": "Le post auto-généré {post_id} a été créé mais aucun chat Telegram n'est configuré - définissez TELEGRAM_BOT_TOKEN et un chat sur la règle ou TELEGRAM_DEFAULT_CHAT_ID.",
        "auto_regenerated": "Le post auto-généré {post_id} a été régénéré après expiration.",
        "auto_timeout_prompt": "Le post auto-généré {post_id} a atteint son heure de publication sans validation - une demande de décision a été envoyée sur Telegram.",
        "auto_cancelled_rule_changed": "Le post auto-généré {post_id} a été annulé car sa règle source a changé ou n'existe plus.",
        "auto_rule_skipped": "Règle '{rule_name}' ignorée - aucune destination de validation Telegram n'est configurée. Définissez TELEGRAM_BOT_TOKEN et TELEGRAM_DEFAULT_CHAT_ID (ou validation_chat_id sur la règle). Les autoposts ne peuvent pas partir sans approbation.",
        "auto_generation_failed": "La règle d'automatisation '{rule_name}' a échoué pendant la génération : {error}",
    },
}


def t(locale: str | None, key: str, **params: Any) -> str:
    lang = normalize_locale(locale)
    template = _TEXT.get(lang, _TEXT["en"]).get(key) or _TEXT["en"].get(key) or key
    return template.format(**params)


def localized_platforms(locale: str | None, platforms: list[str]) -> str:
    lang = normalize_locale(locale)
    labels = _PLATFORMS.get(lang, _PLATFORMS["en"])
    names = [labels.get(platform, platform) for platform in platforms]
    return ", ".join(names) if names else labels["none"]
