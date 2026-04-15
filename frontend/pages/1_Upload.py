from __future__ import annotations

import requests
import streamlit as st

st.set_page_config(page_title="Upload | Offline RAG", page_icon="RAG", layout="wide")

if "api_base_url" not in st.session_state:
    st.session_state.api_base_url = "http://127.0.0.1:8000"

st.sidebar.header("Connection")
st.session_state.api_base_url = st.sidebar.text_input(
    "Backend URL",
    value=st.session_state.api_base_url,
    key="api_base_url_upload",
)

st.title("Upload Documents")
st.caption("Ingest multiple files in one batch request.")

uploaded_files = st.file_uploader(
    "Select one or more PDF, DOCX, or image files",
    type=["pdf", "docx", "png", "jpg", "jpeg", "webp", "bmp"],
    accept_multiple_files=True,
)

if st.button("Ingest Files", use_container_width=True, disabled=not uploaded_files):
    with st.spinner("Ingesting files..."):
        try:
            files = [
                ("files", (item.name, item.getvalue(), item.type or "application/octet-stream"))
                for item in uploaded_files
            ]
            response = requests.post(f"{st.session_state.api_base_url}/upload", files=files, timeout=300)
            if response.ok:
                data = response.json()
                st.success(
                    f"Processed {data.get('total_files', 0)} files: "
                    f"{data.get('succeeded', 0)} succeeded, {data.get('failed', 0)} failed"
                )

                for item in data.get("items", []):
                    if item.get("status") == "success":
                        st.write(
                            f"SUCCESS | {item.get('filename')} | chunks={item.get('chunks_added', 0)}"
                        )
                    else:
                        st.error(f"FAILED | {item.get('filename')} | {item.get('message', 'Unknown error')}")

                with st.expander("Raw API response"):
                    st.json(data)
            else:
                st.error(f"Upload failed: {response.text}")
        except Exception as exc:
            st.error(f"Upload error: {exc}")
