from agno.agent import Agent
from agno.models.openai import OpenAIChat
from config import OPENAI_MODEL
from prompts.booking_prompt import build_booking_prompt
from tools.booking_tools import (
    get_services,
    get_available_times,
    create_appointment,
    cancel_appointment,
)
from tools.client_tools import get_client_pets, get_upcoming_appointments


def build_booking_agent(context: dict, router_ctx: dict) -> Agent:
    return Agent(
        name="Booking Agent",
        model=OpenAIChat(id=OPENAI_MODEL),
        instructions=build_booking_prompt(context, router_ctx),
        tools=[
            get_services,
            get_available_times,
            create_appointment,
            cancel_appointment,
            get_client_pets,
            get_upcoming_appointments,
        ],
    )
