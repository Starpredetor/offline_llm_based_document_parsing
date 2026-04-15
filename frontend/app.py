from __future__ import annotations

import streamlit as st

st.set_page_config(page_title="Offline Multimodal RAG", page_icon="RAG", layout="wide")

if "api_base_url" not in st.session_state:
    st.session_state.api_base_url = "http://127.0.0.1:8000"

st.sidebar.header("Connection")
st.session_state.api_base_url = st.sidebar.text_input(
    "Backend URL",
    value=st.session_state.api_base_url,
    key="api_base_url_input",
)

st.title("Offline Multimodal RAG")
st.caption("Use the sidebar to switch between Upload and Chat Retrieval pages.")

st.markdown("### Workflow")
st.markdown("1. Open **Upload** page and ingest one or more files.")
st.markdown("2. Open **Chat Retrieval** page and ask questions in chatbot mode.")

st.info(f"Current backend: {st.session_state.api_base_url}")
