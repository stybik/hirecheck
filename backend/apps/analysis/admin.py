from django.contrib import admin

from apps.analysis.models import AnalyzedListing, APIUsageLog, UserFeedback

admin.site.register(AnalyzedListing)
admin.site.register(UserFeedback)
admin.site.register(APIUsageLog)
