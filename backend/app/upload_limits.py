"""Bound upload requests before FastAPI parses multipart bodies."""

from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import HTTPException, Request, Response
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.formparsers import MultiPartException
from starlette.types import Message

from app.limits import IMPORT_REQUEST_MAX_BYTES


class LimitedImportRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            limit = IMPORT_REQUEST_MAX_BYTES
            detail = f"Import request must be at most {limit} bytes"
            for value in request.headers.getlist("content-length"):
                try:
                    length = int(value)
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail="Invalid Content-Length") from exc
                if length < 0:
                    raise HTTPException(status_code=400, detail="Invalid Content-Length")
                if length > limit:
                    raise HTTPException(status_code=413, detail=detail)

            received = 0
            exceeded = False

            async def receive() -> Message:
                nonlocal received, exceeded
                message = await request.receive()
                if message["type"] == "http.request":
                    received += len(message.get("body", b""))
                    if received > limit:
                        exceeded = True
                        # This exception makes Starlette close partially spooled files.
                        raise MultiPartException(detail)
                return message

            try:
                return await original(Request(request.scope, receive=receive))
            except StarletteHTTPException as exc:
                if exceeded:
                    raise HTTPException(status_code=413, detail=detail) from exc
                raise

        return handler
