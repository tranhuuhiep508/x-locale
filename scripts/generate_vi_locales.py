#!/usr/bin/env python3
"""Generate ~1000 Vietnamese source strings into locales/ (modular layout)."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "locales"
TARGET = 1000


def build_modules() -> dict[str, dict[str, str]]:
    modules: dict[str, dict[str, str]] = {
        "auth": {
            "email": "Địa chỉ email",
            "password": "Mật khẩu",
            "sign_in": "Đăng nhập",
            "sign_up": "Tạo tài khoản",
            "sign_out": "Đăng xuất",
            "forgot_password": "Quên mật khẩu?",
            "reset_password": "Đặt lại mật khẩu",
            "confirm_password": "Xác nhận mật khẩu",
            "remember_me": "Ghi nhớ đăng nhập",
            "two_factor": "Xác thực hai yếu tố",
            "verify_code": "Xác minh mã",
            "resend_code": "Gửi lại mã",
            "session_expired": "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
            "invalid_credentials": "Email hoặc mật khẩu không đúng",
            "account_locked": "Tài khoản bị khóa do quá nhiều lần đăng nhập thất bại",
            "oauth_google": "Tiếp tục với Google",
            "oauth_microsoft": "Tiếp tục với Microsoft",
            "oauth_github": "Tiếp tục với GitHub",
            "terms_agree": "Tôi đồng ý với Điều khoản dịch vụ",
            "privacy_agree": "Tôi đồng ý với Chính sách bảo mật",
        },
        "common": {
            "cancel": "Hủy",
            "save": "Lưu",
            "delete": "Xóa",
            "edit": "Chỉnh sửa",
            "create": "Tạo mới",
            "update": "Cập nhật",
            "search": "Tìm kiếm",
            "filter": "Lọc",
            "sort": "Sắp xếp",
            "export": "Xuất",
            "import": "Nhập",
            "refresh": "Làm mới",
            "loading": "Đang tải...",
            "no_results": "Không tìm thấy kết quả",
            "confirm": "Xác nhận",
            "back": "Quay lại",
            "next": "Tiếp theo",
            "previous": "Trước",
            "close": "Đóng",
            "yes": "Có",
            "no": "Không",
            "all": "Tất cả",
            "none": "Không có",
            "select_all": "Chọn tất cả",
            "clear": "Xóa",
            "apply": "Áp dụng",
            "reset": "Đặt lại",
            "copy": "Sao chép",
            "copied": "Đã sao chép!",
            "download": "Tải xuống",
            "upload": "Tải lên",
            "view": "Xem",
            "details": "Chi tiết",
            "actions": "Thao tác",
            "status": "Trạng thái",
            "date": "Ngày",
            "time": "Thời gian",
            "name": "Tên",
            "description": "Mô tả",
            "type": "Loại",
            "category": "Danh mục",
            "tags": "Thẻ",
            "notes": "Ghi chú",
            "optional": "Tùy chọn",
            "required": "Bắt buộc",
            "enabled": "Đã bật",
            "disabled": "Đã tắt",
            "active": "Đang hoạt động",
            "inactive": "Không hoạt động",
            "pending": "Đang chờ",
            "completed": "Hoàn thành",
            "failed": "Thất bại",
            "success": "Thành công",
            "warning": "Cảnh báo",
            "error": "Lỗi",
            "info": "Thông tin",
            "total": "Tổng cộng",
            "subtotal": "Tạm tính",
            "amount": "Số tiền",
            "quantity": "Số lượng",
            "price": "Giá",
            "currency": "Tiền tệ",
            "language": "Ngôn ngữ",
            "timezone": "Múi giờ",
            "settings": "Cài đặt",
            "help": "Trợ giúp",
            "support": "Hỗ trợ",
            "feedback": "Phản hồi",
            "version": "Phiên bản",
            "powered_by": "Được hỗ trợ bởi x-locale",
        },
        "homepage": {
            "welcome": "Chào mừng bạn đến ứng dụng!",
            "subtitle": "Quản lý bản dịch dễ dàng.",
            "get_started": "Bắt đầu",
            "learn_more": "Tìm hiểu thêm",
            "hero_title": "Địa phương hóa đơn giản hơn",
            "hero_description": "Ra mắt sản phẩm đa ngôn ngữ nhanh hơn với một nguồn dữ liệu duy nhất cho tất cả chuỗi văn bản.",
            "feature_translate": "Dịch thuật bằng AI",
            "feature_translate_desc": "Dịch sang hàng chục ngôn ngữ chỉ với một cú nhấp chuột.",
            "feature_sync": "Đồng bộ CLI",
            "feature_sync_desc": "Đẩy và kéo tệp ngôn ngữ từ mã nguồn của bạn.",
            "feature_collab": "Cộng tác nhóm",
            "feature_collab_desc": "Xem xét, phê duyệt và xuất bản bản dịch cùng nhau.",
            "cta_primary": "Dùng thử miễn phí",
            "cta_secondary": "Xem tài liệu",
            "stats_users": "{count} người dùng đang hoạt động",
            "stats_languages": "Hỗ trợ {count} ngôn ngữ",
            "stats_strings": "Quản lý {count} chuỗi",
        },
        "errors": {},
        "validation": {},
        "dashboard": {},
        "settings": {},
        "billing": {},
        "users": {},
        "products": {},
        "orders": {},
        "inventory": {},
        "reports": {},
        "notifications": {},
        "onboarding": {},
        "help": {},
        "admin": {},
        "analytics": {},
        "marketing": {},
        "profile": {},
        "search": {},
        "integrations": {},
        "api": {},
    }

    error_msgs = [
        ("not_found", "Không tìm thấy trang"),
        ("server_error", "Đã xảy ra lỗi. Vui lòng thử lại."),
        ("unauthorized", "Bạn không có quyền thực hiện thao tác này"),
        ("forbidden", "Truy cập bị từ chối"),
        ("timeout", "Yêu cầu hết thời gian chờ. Vui lòng thử lại."),
        ("network", "Lỗi mạng. Kiểm tra kết nối của bạn."),
        ("validation_failed", "Vui lòng sửa các lỗi bên dưới"),
        ("rate_limit", "Quá nhiều yêu cầu. Vui lòng đợi một lúc."),
        ("maintenance", "Hệ thống đang bảo trì"),
        ("file_too_large", "Tệp vượt quá kích thước tối đa {max}MB"),
        ("unsupported_format", "Định dạng tệp không được hỗ trợ"),
        ("duplicate_entry", "Mục này đã tồn tại"),
        ("dependency_error", "Không thể hoàn tất do phụ thuộc"),
        ("quota_exceeded", "Bạn đã vượt quá hạn mức gói"),
        ("payment_failed", "Không thể xử lý thanh toán"),
        ("session_invalid", "Phiên không hợp lệ"),
        ("token_expired", "Token đã hết hạn"),
        ("resource_locked", "Tài nguyên đang bị khóa bởi người dùng khác"),
        ("conflict", "Thay đổi xung đột với bản cập nhật khác"),
        ("not_implemented", "Tính năng này chưa khả dụng"),
    ]
    for i in range(50):
        if i < len(error_msgs):
            k, v = error_msgs[i]
        else:
            k, v = f"error_{i:03d}", f"Mã lỗi {i}: Đã xảy ra lỗi không mong muốn"
        modules["errors"][k] = v

    fields = {
        "email": "Email",
        "password": "Mật khẩu",
        "name": "Tên",
        "phone": "Số điện thoại",
        "url": "URL",
        "date": "Ngày",
        "number": "Số",
        "zip": "Mã bưu điện",
        "username": "Tên đăng nhập",
        "title": "Tiêu đề",
    }
    rules = {
        "required": "{f} là bắt buộc",
        "min_length": "{f} phải có ít nhất {{min}} ký tự",
        "max_length": "{f} không được quá {{max}} ký tự",
        "invalid": "{f} không hợp lệ",
        "format": "Định dạng {f_lower} không đúng",
        "unique": "{f} đã được sử dụng",
        "match": "{f} không khớp",
        "range": "{f} phải nằm trong khoảng {{min}} đến {{max}}",
    }
    for field, label in fields.items():
        for rule, tmpl in rules.items():
            modules["validation"][f"{field}_{rule}"] = tmpl.format(
                f=label, f_lower=label.lower()
            )

    dashboard_labels = {
        "overview": "Tổng quan",
        "summary": "Tóm tắt",
        "recent_activity": "Hoạt động gần đây",
        "quick_actions": "Thao tác nhanh",
        "notifications_feed": "Bảng tin thông báo",
        "tasks": "Nhiệm vụ",
        "calendar": "Lịch",
        "metrics": "Số liệu",
        "performance": "Hiệu suất",
        "revenue": "Doanh thu",
        "users_growth": "Tăng trưởng người dùng",
        "conversion_rate": "Tỷ lệ chuyển đổi",
        "bounce_rate": "Tỷ lệ thoát",
        "page_views": "Lượt xem trang",
        "unique_visitors": "Khách truy cập duy nhất",
        "sessions": "Phiên truy cập",
        "avg_session_duration": "Thời lượng phiên trung bình",
        "top_pages": "Trang hàng đầu",
        "top_referrers": "Nguồn giới thiệu hàng đầu",
        "device_breakdown": "Phân bổ thiết bị",
        "geo_distribution": "Phân bổ địa lý",
        "real_time": "Thời gian thực",
        "last_updated": "Cập nhật lần cuối",
        "view_all": "Xem tất cả",
        "customize": "Tùy chỉnh",
        "add_widget": "Thêm widget",
        "remove_widget": "Xóa widget",
        "resize": "Thay đổi kích thước",
        "fullscreen": "Toàn màn hình",
        "share_dashboard": "Chia sẻ bảng điều khiển",
        "export_pdf": "Xuất PDF",
        "export_csv": "Xuất CSV",
        "schedule_report": "Lên lịch báo cáo",
        "date_range": "Khoảng thời gian",
        "compare_periods": "So sánh kỳ",
        "filter_by_team": "Lọc theo nhóm",
        "filter_by_region": "Lọc theo khu vực",
        "filter_by_product": "Lọc theo sản phẩm",
        "no_data": "Không có dữ liệu",
        "loading_metrics": "Đang tải số liệu",
        "refresh_data": "Làm mới dữ liệu",
    }
    for key, label in dashboard_labels.items():
        modules["dashboard"][key] = label
        modules["dashboard"][f"{key}_desc"] = f"Xem số liệu và xu hướng {label.lower()}"

    settings_labels = {
        "general": "Chung",
        "account": "Tài khoản",
        "security": "Bảo mật",
        "privacy": "Quyền riêng tư",
        "notifications": "Thông báo",
        "appearance": "Giao diện",
        "language": "Ngôn ngữ",
        "timezone": "Múi giờ",
        "date_format": "Định dạng ngày",
        "number_format": "Định dạng số",
        "billing": "Thanh toán",
        "subscription": "Đăng ký",
        "team": "Nhóm",
        "members": "Thành viên",
        "roles": "Vai trò",
        "permissions": "Quyền",
        "api_keys": "Khóa API",
        "webhooks": "Webhook",
        "integrations": "Tích hợp",
        "data_export": "Xuất dữ liệu",
        "data_import": "Nhập dữ liệu",
        "backup": "Sao lưu",
        "restore": "Khôi phục",
        "audit_log": "Nhật ký kiểm tra",
        "sessions": "Phiên đăng nhập",
        "two_factor": "Xác thực hai yếu tố",
        "password": "Mật khẩu",
        "email_preferences": "Tùy chọn email",
        "sms_preferences": "Tùy chọn SMS",
        "push_notifications": "Thông báo đẩy",
    }
    for key, label in settings_labels.items():
        modules["settings"][key] = label
        modules["settings"][f"{key}_description"] = f"Cấu hình cài đặt {label.lower()}"

    billing_labels = {
        "plan": "Gói",
        "current_plan": "Gói hiện tại",
        "upgrade": "Nâng cấp",
        "downgrade": "Hạ cấp",
        "cancel_subscription": "Hủy đăng ký",
        "renew": "Gia hạn",
        "billing_cycle": "Chu kỳ thanh toán",
        "monthly": "Hàng tháng",
        "yearly": "Hàng năm",
        "per_month": "Mỗi tháng",
        "per_year": "Mỗi năm",
        "free_trial": "Dùng thử miễn phí",
        "trial_ends": "Dùng thử kết thúc",
        "payment_method": "Phương thức thanh toán",
        "add_card": "Thêm thẻ",
        "update_card": "Cập nhật thẻ",
        "invoice": "Hóa đơn",
        "invoices": "Hóa đơn",
        "receipt": "Biên lai",
        "download_invoice": "Tải hóa đơn",
        "billing_history": "Lịch sử thanh toán",
        "next_billing_date": "Ngày thanh toán tiếp",
        "amount_due": "Số tiền phải trả",
        "paid": "Đã thanh toán",
        "unpaid": "Chưa thanh toán",
        "overdue": "Quá hạn",
        "tax": "Thuế",
        "discount": "Giảm giá",
        "coupon": "Mã giảm giá",
        "apply_coupon": "Áp dụng mã giảm giá",
        "subtotal": "Tạm tính",
        "total_due": "Tổng phải trả",
        "refund": "Hoàn tiền",
        "request_refund": "Yêu cầu hoàn tiền",
        "billing_address": "Địa chỉ thanh toán",
        "company_name": "Tên công ty",
        "vat_number": "Mã số thuế",
        "enterprise": "Doanh nghiệp",
        "contact_sales": "Liên hệ bán hàng",
        "custom_pricing": "Giá tùy chỉnh",
        "usage": "Mức sử dụng",
        "usage_limit": "Giới hạn sử dụng",
    }
    modules["billing"].update(billing_labels)

    user_actions = {
        "create": "Tạo",
        "edit": "Sửa",
        "delete": "Xóa",
        "invite": "Mời",
        "suspend": "Tạm khóa",
        "activate": "Kích hoạt",
        "reset_password": "Đặt lại mật khẩu",
        "assign_role": "Gán vai trò",
        "remove_role": "Gỡ vai trò",
        "view_profile": "Xem hồ sơ",
        "send_message": "Gửi tin nhắn",
        "export_list": "Xuất danh sách",
        "import_users": "Nhập người dùng",
        "bulk_actions": "Thao tác hàng loạt",
    }
    user_fields = {
        "id": "ID",
        "name": "Tên",
        "email": "Email",
        "role": "Vai trò",
        "status": "Trạng thái",
        "last_login": "Đăng nhập lần cuối",
        "created_at": "Ngày tạo",
        "department": "Phòng ban",
        "title": "Chức danh",
        "phone": "Điện thoại",
        "avatar": "Ảnh đại diện",
        "permissions": "Quyền",
    }
    for k, v in user_actions.items():
        modules["users"][f"action_{k}"] = v
    for k, v in user_fields.items():
        modules["users"][f"field_{k}"] = v
    for i in range(1, 26):
        modules["users"][f"role_{i:02d}"] = f"Cấp vai trò {i}"

    product_attrs = {
        "sku": "Mã SKU",
        "name": "Tên",
        "description": "Mô tả",
        "price": "Giá",
        "cost": "Giá vốn",
        "margin": "Biên lợi nhuận",
        "stock": "Tồn kho",
        "category": "Danh mục",
        "brand": "Thương hiệu",
        "weight": "Trọng lượng",
        "dimensions": "Kích thước",
        "color": "Màu sắc",
        "size": "Kích cỡ",
        "material": "Chất liệu",
        "warranty": "Bảo hành",
        "rating": "Đánh giá",
        "reviews": "Nhận xét",
        "images": "Hình ảnh",
        "variants": "Biến thể",
        "tags": "Thẻ",
    }
    product_actions = {
        "add": "Thêm",
        "edit": "Sửa",
        "delete": "Xóa",
        "duplicate": "Nhân bản",
        "archive": "Lưu trữ",
        "publish": "Xuất bản",
        "unpublish": "Ẩn",
        "feature": "Đánh dấu nổi bật",
        "discount": "Giảm giá",
        "bundle": "Gói",
    }
    for k, v in product_attrs.items():
        modules["products"][k] = v
        modules["products"][f"{k}_placeholder"] = f"Nhập {v.lower()}"
    for k, v in product_actions.items():
        modules["products"][f"action_{k}"] = f"{v} sản phẩm"
    for i in range(1, 16):
        modules["products"][f"category_{i:02d}"] = f"Danh mục {i}"

    order_statuses = {
        "pending": "Đang chờ",
        "confirmed": "Đã xác nhận",
        "processing": "Đang xử lý",
        "shipped": "Đã giao hàng",
        "delivered": "Đã nhận",
        "cancelled": "Đã hủy",
        "refunded": "Đã hoàn tiền",
        "returned": "Đã trả hàng",
        "on_hold": "Tạm giữ",
        "failed": "Thất bại",
    }
    order_fields = {
        "order_id": "Mã đơn hàng",
        "customer": "Khách hàng",
        "date": "Ngày",
        "items": "Sản phẩm",
        "shipping": "Vận chuyển",
        "tracking": "Theo dõi",
        "payment": "Thanh toán",
        "notes": "Ghi chú",
        "total": "Tổng cộng",
        "discount": "Giảm giá",
    }
    for k, v in order_statuses.items():
        modules["orders"][f"status_{k}"] = v
    modules["orders"].update(order_fields)
    for i in range(1, 26):
        modules["orders"][f"action_{i:02d}"] = f"Thao tác đơn hàng {i}"

    for i in range(1, 31):
        modules["inventory"][f"item_{i:03d}"] = f"Mục tồn kho {i}"
    for i in range(1, 11):
        modules["inventory"][f"warehouse_{i:02d}"] = f"Kho {i}"

    report_types = {
        "sales": "bán hàng",
        "revenue": "doanh thu",
        "inventory": "tồn kho",
        "users": "người dùng",
        "traffic": "lưu lượng",
        "conversion": "chuyển đổi",
        "retention": "giữ chân",
        "churn": "rời bỏ",
        "support": "hỗ trợ",
        "performance": "hiệu suất",
    }
    periods = {
        "daily": "hàng ngày",
        "weekly": "hàng tuần",
        "monthly": "hàng tháng",
        "quarterly": "hàng quý",
        "yearly": "hàng năm",
    }
    for rt, rt_vi in report_types.items():
        for period, period_vi in periods.items():
            modules["reports"][f"{rt}_{period}"] = f"Báo cáo {rt_vi} ({period_vi})"
        modules["reports"][f"{rt}_export"] = f"Xuất báo cáo {rt_vi}"

    notif_types = {
        "info": "thông tin",
        "success": "thành công",
        "warning": "cảnh báo",
        "error": "lỗi",
        "mention": "đề cập",
        "assignment": "phân công",
        "comment": "bình luận",
        "update": "cập nhật",
        "reminder": "nhắc nhở",
        "deadline": "hạn chót",
    }
    for nt, nt_vi in notif_types.items():
        modules["notifications"][f"type_{nt}"] = f"Thông báo {nt_vi}"
        modules["notifications"][f"type_{nt}_body"] = f"Bạn có thông báo {nt_vi} mới"
    for i in range(1, 21):
        modules["notifications"][f"template_{i:02d}"] = f"Mẫu thông báo {i}"

    onboarding = {
        "welcome": "Chào mừng! Hãy thiết lập không gian làm việc của bạn.",
        "profile": "Cho chúng tôi biết về bạn",
        "team": "Mời thành viên nhóm",
        "project": "Tạo dự án đầu tiên",
        "import": "Nhập bản dịch hiện có",
        "integrate": "Kết nối kho mã nguồn",
        "translate": "Thử dịch bằng AI",
        "publish": "Xuất bản chuỗi đầu tiên",
        "complete": "Bạn đã sẵn sàng!",
    }
    for i, (key, val) in enumerate(onboarding.items(), 1):
        modules["onboarding"][key] = val
        modules["onboarding"][f"step_{i}"] = f"Bước {i}: {val}"
        modules["onboarding"][f"step_{i}_hint"] = "Hoàn thành bước này để tiếp tục"
    for i in range(1, 16):
        modules["onboarding"][f"tip_{i:02d}"] = (
            f"Mẹo #{i}: Khám phá bảng điều khiển để tìm thêm tính năng."
        )

    help_topics = {
        "getting_started": "Bắt đầu",
        "faq": "Câu hỏi thường gặp",
        "tutorials": "Hướng dẫn",
        "api_docs": "Tài liệu API",
        "cli_guide": "Hướng dẫn CLI",
        "billing_help": "Trợ giúp thanh toán",
        "security": "Bảo mật",
        "troubleshooting": "Xử lý sự cố",
        "contact": "Liên hệ",
        "community": "Cộng đồng",
    }
    for topic, label in help_topics.items():
        modules["help"][topic] = label
        modules["help"][f"{topic}_intro"] = f"Tìm hiểu về {label.lower()}"
        for j in range(1, 3):
            modules["help"][f"{topic}_q{j}"] = f"Câu hỏi {j} về {label.lower()}?"
            modules["help"][f"{topic}_a{j}"] = f"Câu trả lời {j} cho {label.lower()}."

    admin_sections = {
        "users": "người dùng",
        "roles": "vai trò",
        "permissions": "quyền",
        "projects": "dự án",
        "locales": "ngôn ngữ",
        "modules": "mô-đun",
        "strings": "chuỗi",
        "activities": "hoạt động",
        "api_keys": "khóa API",
        "system": "hệ thống",
        "logs": "nhật ký",
        "cache": "bộ nhớ đệm",
        "jobs": "tác vụ",
        "email": "email",
        "storage": "lưu trữ",
    }
    admin_actions = {
        "list": "Danh sách",
        "create": "Tạo",
        "edit": "Sửa",
        "delete": "Xóa",
        "view": "Xem",
        "export": "Xuất",
    }
    for sec, sec_vi in admin_sections.items():
        for action, action_vi in admin_actions.items():
            modules["admin"][f"{sec}_{action}"] = f"{action_vi} {sec_vi}"

    metrics = {
        "pageviews": "Lượt xem",
        "sessions": "Phiên truy cập",
        "users": "Người dùng",
        "bounce_rate": "Tỷ lệ thoát",
        "conversion": "Chuyển đổi",
        "revenue": "Doanh thu",
        "aov": "Giá trị đơn hàng TB",
        "cart_abandonment": "Bỏ giỏ hàng",
        "retention": "Giữ chân",
        "ltv": "Giá trị trọn đời",
        "cac": "Chi phí thu hút",
        "roi": "ROI",
        "ctr": "CTR",
        "impressions": "Lượt hiển thị",
        "clicks": "Lượt nhấp",
        "engagement": "Tương tác",
    }
    metric_periods = {
        "today": "hôm nay",
        "week": "tuần",
        "month": "tháng",
        "quarter": "quý",
        "year": "năm",
    }
    for m, m_vi in metrics.items():
        for period, period_vi in metric_periods.items():
            modules["analytics"][f"{m}_{period}"] = f"{m_vi} ({period_vi})"

    campaigns = ["email", "sms", "push", "social", "display", "search", "affiliate", "referral"]
    for ct in campaigns:
        modules["marketing"][f"campaign_{ct}"] = f"Chiến dịch {ct}"
        for i in range(1, 5):
            modules["marketing"][f"{ct}_template_{i}"] = f"Mẫu {ct} {i}"

    profile_fields = {
        "avatar": "Ảnh đại diện",
        "display_name": "Tên hiển thị",
        "bio": "Giới thiệu",
        "location": "Vị trí",
        "website": "Trang web",
        "twitter": "Twitter",
        "linkedin": "LinkedIn",
        "github": "GitHub",
        "phone": "Điện thoại",
        "birthday": "Ngày sinh",
        "gender": "Giới tính",
        "language": "Ngôn ngữ",
        "timezone": "Múi giờ",
    }
    for k, v in profile_fields.items():
        modules["profile"][k] = v
        modules["profile"][f"{k}_hint"] = f"{v} của bạn"
    for i in range(1, 15):
        modules["profile"][f"preference_{i:02d}"] = f"Tùy chọn {i}"

    facets = {
        "all": "Tất cả",
        "strings": "Chuỗi",
        "modules": "Mô-đun",
        "users": "Người dùng",
        "products": "Sản phẩm",
        "orders": "Đơn hàng",
        "docs": "Tài liệu",
        "settings": "Cài đặt",
    }
    for facet, label in facets.items():
        modules["search"][f"facet_{facet}"] = label
        modules["search"][f"facet_{facet}_empty"] = f"Không tìm thấy {label.lower()}"
    for i in range(1, 21):
        modules["search"][f"suggestion_{i:02d}"] = f"Gợi ý tìm kiếm {i}"

    integrations = [
        "github",
        "gitlab",
        "bitbucket",
        "slack",
        "discord",
        "jira",
        "linear",
        "figma",
        "crowdin",
        "lokalise",
        "phrase",
        "webhook",
        "zapier",
    ]
    for integ in integrations:
        name = integ.title()
        modules["integrations"][integ] = f"Tích hợp {name}"
        modules["integrations"][f"{integ}_connect"] = f"Kết nối {name}"
        modules["integrations"][f"{integ}_disconnect"] = f"Ngắt kết nối {name}"
        modules["integrations"][f"{integ}_status"] = f"Trạng thái kết nối {name}"

    api_sections = {
        "authentication": "xác thực",
        "projects": "dự án",
        "strings": "chuỗi",
        "modules": "mô-đun",
        "locales": "ngôn ngữ",
        "export": "xuất",
        "import": "nhập",
        "translate": "dịch",
        "activities": "hoạt động",
        "webhooks": "webhook",
    }
    for sec, sec_vi in api_sections.items():
        modules["api"][f"{sec}_title"] = f"API {sec_vi.title()}"
        modules["api"][f"{sec}_description"] = f"Các endpoint quản lý {sec_vi}"
        for method in ["get", "post", "put", "patch", "delete"]:
            modules["api"][f"{sec}_{method}"] = f"{method.upper()} /api/{sec}"

    return modules


def trim_to_target(modules: dict[str, dict[str, str]], target: int) -> dict[str, dict[str, str]]:
    total = sum(len(v) for v in modules.values())
    while total > target:
        largest = max(modules, key=lambda m: len(modules[m]))
        keys = list(modules[largest].keys())
        if len(keys) <= 3:
            break
        del modules[largest][keys[-1]]
        total -= 1
    return modules


def pad_to_target(modules: dict[str, dict[str, str]], target: int) -> dict[str, dict[str, str]]:
    total = sum(len(v) for v in modules.values())
    i = 1
    while total < target:
        modules["common"][f"extra_{i:04d}"] = f"Chuỗi bổ sung {i}"
        total += 1
        i += 1
    return modules


def main() -> None:
    modules = build_modules()
    total = sum(len(v) for v in modules.values())
    if total > TARGET:
        modules = trim_to_target(modules, TARGET)
    elif total < TARGET:
        modules = pad_to_target(modules, TARGET)

    if ROOT.exists():
        for f in ROOT.rglob("*.json"):
            if f.name in ("en.json", "vi.json"):
                f.unlink()
        for d in ROOT.iterdir():
            if d.is_dir() and not any(d.iterdir()):
                d.rmdir()

    for module, strings in modules.items():
        mod_dir = ROOT / module
        mod_dir.mkdir(parents=True, exist_ok=True)
        path = mod_dir / "vi.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(strings, f, ensure_ascii=False, indent=2)
            f.write("\n")

    manifest = {
        "modules": sorted(modules.keys()),
        "locales": ["vi"],
        "base_language": "vi",
    }
    with open(ROOT / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")

    total = sum(len(v) for v in modules.values())
    print(f"Generated {total} Vietnamese keys into {ROOT}")
    for m in sorted(modules):
        print(f"  {m}: {len(modules[m])}")


if __name__ == "__main__":
    main()
