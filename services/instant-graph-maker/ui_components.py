from __future__ import annotations

import json

import altair as alt
import numpy as np
import pandas as pd
import prophet
import streamlit as st

from constants import (
    ENTRY_HISTORY_INDEX,
    IMPROVEMENT_ENTRY_INDEX,
    IMPROVEMENT_QUERY,
    ORIGINAL_QUERY,
)

def render_chart(entry, dfs) -> None:
    try:
        # Restricted global context for exec
        _globals = {
            "alt": alt,
            "np": np,
            "pd": pd,
            "prophet": prophet,
            "st": st,
            "dfs": dfs,
        }
        exec(entry['code'], _globals, {})
    except Exception as e:
        st.write("There was an error. Navigate to the latest working version and submit a new improvement query.")
        with st.expander('Show code', expanded=False):
            st.code(entry['code'])
        with st.expander('Show error', expanded=False):
            st.code(e)
            def fix_error(e):
                st.session_state[IMPROVEMENT_QUERY] = f"Fix this error: \n {e}"
                st.session_state['trigger_fix_error'] = True

            if st.button("Fix", width='stretch', key=f"fix_error_btn_{np.random.randint(0, 1000000)}"):
                fix_error(e)

            if st.session_state.get('trigger_fix_error', False):
                st.session_state['trigger_fix_error'] = False 
                st.rerun()


def render_improvement_form(improvement_entry_index) -> None:
    with st.form(key='improvement_form'):
        improvement_input = st.text_area(
            "Ask for an improvement", 
            key='current_improvement_query_value',
            height=200
        )
        submit_button = st.form_submit_button("Improve chart", use_container_width=True)
        
        if submit_button and improvement_input:
            st.session_state[IMPROVEMENT_QUERY] = improvement_input
            st.session_state[IMPROVEMENT_ENTRY_INDEX] = improvement_entry_index
            st.session_state[ENTRY_HISTORY_INDEX] = None
            st.rerun()

def render_new_exploration_from_code(chart_gen) -> None:
    st.markdown('### Create from copied exploration')
    
    def load_exploration():
        try:
            pasted_data = st.session_state['pasted_exploration_value']
            if not pasted_data.strip():
                st.error("Paste exploration data")
                return
            
            exploration_data = json.loads(pasted_data)
            
            if 'history' not in exploration_data:
                st.error("The exploration data isn’t in a valid format: missing 'history' field")
                return
            
            chart_gen.history = exploration_data['history']
            st.session_state[ORIGINAL_QUERY] = exploration_data['history'][0]['query']
            
            # Clear state to prevent rerun loops
            st.session_state[IMPROVEMENT_QUERY] = ""
            st.session_state[IMPROVEMENT_ENTRY_INDEX] = None
            st.session_state[ENTRY_HISTORY_INDEX] = None
            
            st.session_state['trigger_load_exploration'] = True
            
        except json.JSONDecodeError as e:
            st.error(f"Invalid JSON format: {e}")
        except Exception as e:
            st.error(f"There was an error loading the exploration: {e}")
    
    st.text_area(
        "Paste exploration data here",
        key='pasted_exploration_value',
        height=100,
        placeholder='Paste the copied exploration JSON here...'
    )
    
    if st.button("Load exploration", key="load_exploration_btn"):
        load_exploration()
    
    if st.session_state.get('trigger_load_exploration', False):
        st.session_state['trigger_load_exploration'] = False
        st.rerun()